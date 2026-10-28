#!/usr/bin/env node
/**
 * 外部消费者 smoke：不依赖仓库 workspace，模拟一个游戏工程从零接入。
 *
 * 1. 临时工程用 SDK 模板的 setup-sdk.mjs 打包并安装四个 tarball；
 * 2. 用安装后的 build.mjs 构建、打包，并用 --host 跑 bpmap doctor；
 * 3. 把包复制到 games/，启动宿主，确认 /api/games 能加载。
 *
 * 用法：node tools/checks/smoke-sdk.mjs
 * 前置：平台已 npm run build；会联网安装 esbuild，结束后删除临时工程和 games 里的 smoke 包。
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 3296;
const RESTART_PORT = 3297;
const GAME_ID = 'sdk-smoke-game';
const HOST_CLI = join(ROOT, 'packages', 'hostd', 'dist', 'cli.js');
const SETUP_TEMPLATE = join(ROOT, 'packages', 'sdk-tools', 'templates', 'scripts', 'setup-sdk.mjs');
const project = mkdtempSync(join(tmpdir(), 'bp-sdk-smoke-'));
const dataDir = mkdtempSync(join(tmpdir(), 'bp-sdk-smoke-data-'));
const installedPack = join(ROOT, 'games', `${GAME_ID}.bpmap`);
let host = null;
let hostLog = '';
let hostPort = PORT;

function fail(message) {
  throw new Error(message);
}

function run(args, cwd, label) {
  console.log(`\n[smoke] ${label}`);
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) fail(`${label} 失败（exit ${result.status}）`);
}

async function waitHealth(port, timeout = 12_000) {
  const base = `http://127.0.0.1:${port}`;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // 还没起来
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  fail(`宿主 ${port} 没在 ${timeout}ms 内起来：\n${hostLog.slice(-2000)}`);
}

function startHost(port) {
  hostPort = port;
  host = spawn(process.execPath, [HOST_CLI, 'host', '--port', String(port), '--no-lan'], {
    cwd: ROOT,
    env: { ...process.env, BP_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  host.stdout.on('data', (chunk) => { hostLog += chunk.toString(); });
  host.stderr.on('data', (chunk) => { hostLog += chunk.toString(); });
}

async function stopHost() {
  if (!host) return;
  const child = host;
  host = null;
  child.kill('SIGTERM');
  await new Promise((resolvePromise) => {
    if (child.exitCode !== null) return resolvePromise(undefined);
    child.once('close', () => resolvePromise(undefined));
    setTimeout(resolvePromise, 3000);
  });
}

try {
  if (!existsSync(HOST_CLI)) fail('宿主壳还没构建：先跑 npm run build');
  if (!existsSync(SETUP_TEMPLATE)) fail(`找不到 setup 模板：${SETUP_TEMPLATE}`);
  if (existsSync(installedPack)) fail(`${installedPack} 已存在；先移走，避免覆盖你正在用的包`);
  mkdirSync(join(project, 'scripts'), { recursive: true });
  mkdirSync(join(project, 'src', 'assets'), { recursive: true });
  writeFileSync(
    join(project, 'package.json'),
    JSON.stringify({
      name: 'sdk-smoke-game',
      version: '0.1.0',
      private: true,
      type: 'module',
      bp: { id: GAME_ID, entry: 'client/client.js', mode: 'turn', apiVersion: 1 },
    }, null, 2) + '\n',
    'utf8',
  );
  writeFileSync(
    join(project, 'src', 'server.ts'),
    `import { stableDigest, type GameContext, type GameInstance, type GameModule, type Outcome } from '@lizardon386/game-sdk';
import { FeedLog } from '@lizardon386/game-sdk/kit/server';

class SmokeGame implements GameInstance {
  private readonly feed: FeedLog;

  constructor(private readonly ctx: GameContext) {
    this.feed = new FeedLog({ now: () => this.ctx.now() });
  }

  begin(): Outcome {
    this.feed.emit({ type: 'smoke', text: '外部接入 smoke 开局' });
    return this.feed.drainEffects();
  }

  handle(action: { name: string }): Outcome {
    this.feed.emit({ type: 'smoke', text: \`收到 \${action.name}\` });
    return [{ kind: 'broadcast', name: 'smoke', payload: { name: action.name } }, ...this.feed.drainEffects()];
  }

  serialize(viewer: string | null): unknown {
    return { viewer, feed: this.feed.viewFor(viewer) };
  }

  snapshot(): unknown {
    return { version: 1 };
  }
}

export const smokeGame: GameModule = {
  id: '${GAME_ID}',
  name: 'SDK 外部接入 smoke',
  version: '0.1.0',
  entry: 'client/client.js',
  seats: { min: 1, max: 2 },
  allowSpectate: true,
  soloFill: false,
  roles: ['host', 'player', 'spectator'],
  normalizeConfig: () => ({}),
  rulesHashOf: (config) => stableDigest(config),
  create: (_config, ctx) => new SmokeGame(ctx),
  resume: (_snapshot, ctx) => new SmokeGame(ctx),
  acceptsSnapshot: (snapshot) => (snapshot as { version?: number } | null)?.version === 1,
};

export default smokeGame;
`,
    'utf8',
  );
  writeFileSync(
    join(project, 'src', 'client.ts'),
    `import { ChatPanel } from '@lizardon386/game-sdk/kit';

export default {
  mount(host: HTMLElement) {
    host.replaceChildren();
    const title = document.createElement('h1');
    title.textContent = 'SDK 外部接入 smoke';
    const panel = document.createElement('div');
    host.append(title, panel);
    new ChatPanel({ mount: panel });
  },
};
`,
    'utf8',
  );
  writeFileSync(join(project, 'src', 'assets', 'notice.json'), '{"text":"外部 smoke 资源"}\n', 'utf8');
  cpSync(SETUP_TEMPLATE, join(project, 'scripts', 'setup-sdk.mjs'));

  run([join(project, 'scripts', 'setup-sdk.mjs'), '--platform', ROOT], project, '安装四个 SDK tarball');
  const buildTemplate = join(project, 'node_modules', '@lizardon386', 'sdk-tools', 'templates', 'scripts', 'build.mjs');
  if (!existsSync(buildTemplate)) fail(`安装后找不到 build 模板：${buildTemplate}`);
  cpSync(buildTemplate, join(project, 'scripts', 'build.mjs'));

  startHost(PORT);
  await waitHealth(PORT);
  run(
    [join(project, 'scripts', 'build.mjs'), '--platform', ROOT, '--host', `http://127.0.0.1:${PORT}`],
    project,
    '构建、打包、doctor',
  );

  // build 把包复制进 games/ 时宿主已经启动，换端口重启一次让 loader 扫到新包
  await stopHost();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  startHost(RESTART_PORT);
  await waitHealth(RESTART_PORT);
  const response = await fetch(`http://127.0.0.1:${RESTART_PORT}/api/games`);
  const body = await response.json();
  const loaded = body.games?.find((game) => game.id === GAME_ID);
  if (!loaded) fail(`宿主没有加载 smoke 包：${JSON.stringify(body)}`);
  if (!loaded.assets?.some((asset) => asset.path === 'client/client.js')) {
    fail(`smoke 包的客户端入口没有进 manifest：${JSON.stringify(loaded)}`);
  }
  if (!loaded.assets?.some((asset) => asset.path === 'client/assets/notice.json')) {
    fail(`smoke 包的资源没有进 manifest：${JSON.stringify(loaded)}`);
  }

  const pack = readFileSync(installedPack);
  console.log(`\n[smoke] OK：${GAME_ID} 已由外部工程构建并被宿主加载（${pack.byteLength} 字节包）`);
} catch (error) {
  console.error(`\n[smoke] 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await stopHost().catch(() => undefined);
  for (const [path, label] of [[installedPack, 'smoke 包'], [project, '临时工程'], [dataDir, '临时数据目录']]) {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (error) {
      console.error(`[smoke] 清理${label}失败（可手动删除）：${path}（${String(error)}）`);
    }
  }
}
