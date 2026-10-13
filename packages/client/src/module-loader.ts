import type { GameManifest } from '@bp/protocol';

/**
 * 游戏模块的客户端侧加载（war3 对战平台的"地图自动下载"位）：
 * 房主进程已经把 games/<id>/dist 静态暴露出来，客户端缺模块时直接拉过来挂载。
 * 声明了 assets 哈希的逐个校验；没声明的照拉，但要把"未校验"讲清楚。
 */

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export interface GameClientContract {
  /** 把对局状态渲染进容器；返回的视图要能在下一次 mount 时替换。 */
  mount(host: HTMLElement, view: unknown, actions: GameActions): void;
  unmount?(host: HTMLElement): void;
  onEvent?(event: { name: string; payload?: unknown }, actions: GameActions): void;
}

export interface GameActions {
  send(name: string, payload?: unknown): void;
  seatId(): string | null;
}

export interface LoadResult {
  ok: boolean;
  client: GameClientContract | null;
  verified: boolean;
  reason?: string;
}

export async function fetchGameList(httpOrigin: string, fetchImpl: FetchImpl = fetch): Promise<GameManifest[]> {
  const response = await fetchImpl(`${httpOrigin}/api/games`, { mode: 'cors' });
  if (!response.ok) throw new Error(`拿游戏清单失败：${response.status}`);
  const data = (await response.json()) as { games?: GameManifest[] };
  return Array.isArray(data.games) ? data.games : [];
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 哈希可以是 'sha256:<hex>' 或裸 hex。 */
function normalizeHash(hash: string): string {
  return hash.startsWith('sha256:') ? hash.slice('sha256:'.length) : hash;
}

export async function assetMatches(
  url: string,
  expectedHash: string,
  fetchImpl: FetchImpl = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(url, { mode: 'cors' });
    if (!response.ok) return false;
    const actual = await sha256Hex(await response.arrayBuffer());
    return actual === normalizeHash(expectedHash).toLowerCase();
  } catch {
    return false;
  }
}

/**
 * 动态挂载用的模块从房主来源取，浏览器要求整段脚本同源或带 CORS；
 * 校验过的字节走 blob URL 导入，避免"边下载边执行"绕过哈希。
 */
export async function loadGameClient(
  manifest: GameManifest,
  httpOrigin: string,
  fetchImpl: FetchImpl = fetch,
): Promise<LoadResult> {
  const entryUrl = `${httpOrigin}/games/${encodeURIComponent(manifest.id)}/${manifest.entry.replace(/^\/+/, '')}`;
  const declared = manifest.assets?.find((a) => a.path === manifest.entry);
  let source = '';
  try {
    const response = await fetchImpl(entryUrl, { mode: 'cors' });
    if (!response.ok) {
      // 这句会直接显示给玩家，别写成报错口气：没有专属界面是平台的正常降级路径（占位面板），
      // 括号里留状态码是给接真游戏的人调试用的。
      return { ok: false, client: null, verified: false, reason: `${manifest.name} 没带自己的界面，先用平台自带的状态面板显示（拿入口得到 ${response.status}）` };
    }
    source = await response.text();
  } catch (error) {
    return { ok: false, client: null, verified: false, reason: `拉取 ${manifest.id} 失败：${String(error)}` };
  }
  let verified = false;
  if (declared?.hash) {
    const bytes = new TextEncoder().encode(source);
    const digest = await sha256Hex(bytes.buffer as ArrayBuffer);
    if (digest !== normalizeHash(declared.hash).toLowerCase()) {
      return { ok: false, client: null, verified: false, reason: `${manifest.id} 与房主的版本校验不一致，已拒绝执行` };
    }
    verified = true;
  }
  const blobUrl = URL.createObjectURL(new Blob([source], { type: 'module' }));
  try {
    const loaded = (await import(/* webpackIgnore: true */ blobUrl)) as Record<string, unknown>;
    const client = (loaded.default ?? loaded.client) as GameClientContract | undefined;
    if (!client || typeof client.mount !== 'function') {
      return { ok: false, client: null, verified, reason: `${manifest.id} 的客户端入口没有导出 mount()` };
    }
    return { ok: true, client, verified };
  } catch (error) {
    return { ok: false, client: null, verified, reason: `模块加载失败：${String(error)}` };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/** 没有客户端模块时的兜底渲染：把状态原样摊开，仍然可点动作。 */
export function placeholderClient(manifest: GameManifest): GameClientContract {
  return {
    mount(host: HTMLElement, view: unknown, actions: GameActions) {
      host.replaceChildren();
      const box = document.createElement('div');
      box.className = 'game-placeholder';
      const title = document.createElement('p');
      title.textContent = `${manifest.name} 没有自带客户端界面，下面是房主发来的原始状态（本机版本 ${manifest.version}）`;
      box.append(title);
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(view, null, 2);
      box.append(pre);
      const row = document.createElement('div');
      row.className = 'placeholder-actions';
      for (const name of placeholderActions(view)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = name;
        button.addEventListener('click', () => actions.send(name));
        row.append(button);
      }
      box.append(row);
      host.append(box);
    },
  };
}

function placeholderActions(view: unknown): string[] {
  if (!view || typeof view !== 'object') return [];
  const kind = (view as { kind?: unknown }).kind;
  if (kind === 'count') return ['plus', 'minus'];
  return [];
}
