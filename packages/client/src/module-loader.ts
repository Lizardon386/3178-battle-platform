import type { GameManifest } from '@bp/protocol';

/**
 * 游戏模块的客户端侧加载（war3 对战平台的"地图自动下载"位）：
 * 房主进程已经把 games/<id>/dist 静态暴露出来，客户端缺模块时直接拉过来挂载。
 * 声明了 assets 哈希的逐个校验；没声明的照拉，但要把"未校验"讲清楚。
 *
 * 真正执行游戏代码的是 game-sandbox.html 里的 iframe：
 * sandbox=allow-scripts，不给 allow-same-origin，拿不到宿主的 localStorage、票据和 DOM。
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

export interface ClientSourceResult {
  ok: boolean;
  source: string;
  verified: boolean;
  /** 客户端入口所在目录；沙箱用它作为相对资源地址的 base。 */
  baseUrl: string;
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

/** 只负责取源码和校验；执行交给沙箱 iframe。 */
export async function loadGameClientSource(
  manifest: GameManifest,
  httpOrigin: string,
  fetchImpl: FetchImpl = fetch,
): Promise<ClientSourceResult> {
  const entryUrl = `${httpOrigin}/games/${encodeURIComponent(manifest.id)}/${manifest.entry.replace(/^\/+/, '')}`;
  const declared = manifest.assets?.find((asset) => asset.path === manifest.entry);
  let source = '';
  try {
    const response = await fetchImpl(entryUrl, { mode: 'cors' });
    if (!response.ok) {
      // 这句会直接显示给玩家，别写成报错口气：没有专属界面是平台的正常降级路径（占位面板），
      // 括号里留状态码是给接真游戏的人调试用的。
      return {
        ok: false,
        source: '',
        verified: false,
        baseUrl: '',
        reason: `${manifest.name} 没带自己的界面，先用平台自带的状态面板显示（拿入口得到 ${response.status}）`,
      };
    }
    source = await response.text();
  } catch (error) {
    return { ok: false, source: '', verified: false, baseUrl: '', reason: `拉取 ${manifest.id} 失败：${String(error)}` };
  }

  let verified = false;
  if (declared?.hash) {
    if (!globalThis.crypto?.subtle) {
      return {
        ok: false,
        source: '',
        verified: false,
        baseUrl: '',
        reason: '当前页面不是安全上下文，无法校验客户端代码；请用 http://127.0.0.1:3178 打开。',
      };
    }
    try {
      const bytes = new TextEncoder().encode(source);
      const digest = await sha256Hex(bytes.buffer as ArrayBuffer);
      if (digest !== normalizeHash(declared.hash).toLowerCase()) {
        return { ok: false, source: '', verified: false, baseUrl: '', reason: `${manifest.id} 与房主的版本校验不一致，已拒绝执行` };
      }
      verified = true;
    } catch (error) {
      return { ok: false, source: '', verified: false, baseUrl: '', reason: `校验客户端代码失败：${String(error)}` };
    }
  }
  return { ok: true, source, verified, baseUrl: new URL('.', entryUrl).href };
}

export interface SandboxOptions {
  baseUrl: string;
  onError?: (message: string) => void;
  /** 仅供测试替换；默认走平台自己的静态页。 */
  frameUrl?: string;
}

/**
 * 父页面一侧的代理：创建沙箱 iframe，把 mount/view/event 转成消息，把 action 转回平台。
 * 客户端契约保持 mount/unmount/onEvent 不变，游戏代码本身不知道自己在 iframe 里。
 */
export function sandboxedClient(manifest: GameManifest, source: string, options: SandboxOptions): GameClientContract {
  let frame: HTMLIFrameElement | null = null;
  let win: Window | null = null;
  let actions: GameActions | null = null;
  let view: unknown = null;
  let seatId: string | null = null;
  let ready = false;
  let disposed = false;
  let timer: number | null = null;
  let pendingEvents: Array<{ name: string; payload?: unknown }> = [];

  const post = (data: unknown): void => {
    frame?.contentWindow?.postMessage(data, '*');
  };

  const cleanup = (): void => {
    if (timer !== null && win) {
      win.clearTimeout(timer);
      timer = null;
    }
    if (win) win.removeEventListener('message', onMessage);
    frame?.remove();
    frame = null;
    win = null;
    ready = false;
  };

  const fail = (message: string): void => {
    if (disposed) return;
    disposed = true;
    cleanup();
    options.onError?.(message);
  };

  const onMessage = (event: MessageEvent): void => {
    if (disposed || !frame || event.source !== frame.contentWindow) return;
    const data = event.data as { type?: unknown; name?: unknown; payload?: unknown; message?: unknown } | null;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'ready') {
      ready = true;
      if (timer !== null && win) {
        win.clearTimeout(timer);
        timer = null;
      }
      post({ type: 'mount', source, baseUrl: options.baseUrl, view, seatId });
      for (const queued of pendingEvents) post({ type: 'event', name: queued.name, payload: queued.payload });
      pendingEvents = [];
      return;
    }
    if (data.type === 'action') {
      if (typeof data.name === 'string') actions?.send(data.name, data.payload);
      return;
    }
    if (data.type === 'error') fail(String(data.message ?? '游戏界面加载失败'));
  };

  return {
    mount(host: HTMLElement, nextView: unknown, nextActions: GameActions): void {
      if (disposed) return;
      actions = nextActions;
      view = nextView;
      seatId = nextActions.seatId();
      if (frame) {
        if (ready) post({ type: 'view', view, seatId });
        return;
      }
      win = host.ownerDocument.defaultView;
      if (!win) {
        fail('找不到浏览器窗口，无法挂载游戏界面');
        return;
      }
      win.addEventListener('message', onMessage);
      const iframe = host.ownerDocument.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('title', `${manifest.name} 游戏界面`);
      iframe.className = 'game-frame';
      iframe.src = options.frameUrl ?? '/game-sandbox.html';
      frame = iframe;
      timer = win.setTimeout(() => fail('游戏界面沙箱加载超时'), 8_000);
      host.replaceChildren(iframe);
    },
    onEvent(event: { name: string; payload?: unknown }, nextActions: GameActions): void {
      if (disposed) return;
      actions = nextActions;
      seatId = nextActions.seatId();
      if (ready) post({ type: 'event', name: event.name, payload: event.payload });
      else pendingEvents.push(event);
    },
    unmount(host: HTMLElement): void {
      if (disposed) return;
      post({ type: 'unmount' });
      cleanup();
      disposed = true;
      host.replaceChildren();
    },
  };
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
