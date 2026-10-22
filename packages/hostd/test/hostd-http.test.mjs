import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

/**
 * 宿主壳的集成测试：真起一个 hostd host 子进程，验静态路由、接口、路径穿越防线，
 * 并用真 WebSocket 客户端连进去走完 hello → welcome。
 * 用 --no-lan 关掉组播，测试绝不碰网卡和防火墙。
 */

const HERE = dirnameSafe(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const PORT = 3211;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = mkdtempSync(join(tmpdir(), 'bp-hostd-http-'));

function dirnameSafe(path) {
  return path.replace(/[^/\\]+$/, '');
}

let child = null;

async function get(pathName) {
  const response = await fetch(`${BASE}${pathName}`);
  return { status: response.status, body: await response.text(), headers: response.headers };
}

before(async () => {
  child = spawn(process.execPath, [join(ROOT, 'packages', 'hostd', 'dist', 'cli.js'), 'host', '--port', String(PORT), '--no-lan'], {
    cwd: ROOT,
    env: { ...process.env, BP_DATA_DIR: DATA_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  const deadline = Date.now() + 12_000;
  for (;;) {
    try {
      const probe = await fetch(`${BASE}/health`);
      if (probe.ok) break;
    } catch {
      // 还没起来
    }
    if (Date.now() > deadline) throw new Error(`hostd 没在 12 秒内起来：${stdout}`);
    await new Promise((r) => setTimeout(r, 120));
  }
});

after(() => {
  child?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

test('/api/games 报出本机装的游戏，含房规摘要与入口', async () => {
  const { status, body } = await get('/api/games');
  assert.equal(status, 200);
  const games = JSON.parse(body).games;
  assert.deepEqual(games.map((g) => g.id).sort(), ['fixture-simultaneous', 'fixture-turn']);
  const fixture = games.find((g) => g.id === 'fixture-turn');
  assert.equal(fixture.seats.min, 2);
  assert.equal(fixture.rulesHash.length, 16);
  assert.ok(!fixture.entry.includes('..'), '入口路径不许越界');
});

test('/api/version 报出平台版本与支持的包/协议/接口版本', async () => {
  const { status, body } = await get('/api/version');
  assert.equal(status, 200);
  const version = JSON.parse(body);
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(version.platform, pkg.version);
  assert.deepEqual(version.packFormats, [1]);
  assert.deepEqual(version.protocolVersions, [1]);
  assert.deepEqual(version.apiVersions, [1]);
  assert.deepEqual(version.modes, { turn: [1] });
  assert.deepEqual(version.clientCaps, []);
});

test('页面、客户端模块与协议包都能取到，且 MIME 是对的', async () => {
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(page.body, /对战平台/);
  assert.match(page.body, /"imports"/);

  const app = await get('/app/app.js');
  assert.equal(app.status, 200);
  assert.match(app.headers.get('content-type'), /javascript/);

  const protocol = await get('/vendor/protocol/index.js');
  assert.equal(protocol.status, 200);
  const css = await get('/style.css');
  assert.match(css.headers.get('content-type'), /text\/css/);
});

test('底座样式与图标字体同源可达（离线双击不依赖 CDN）', async () => {
  const core = await get('/vendor/tabler/tabler.min.css');
  assert.equal(core.status, 200);
  assert.match(core.headers.get('content-type'), /text\/css/);
  assert.ok(core.body.includes('--tblr-primary'), '要真的是 Tabler 的变量层');

  const icons = await get('/vendor/tabler-icons/tabler-icons.min.css');
  assert.equal(icons.status, 200);
  assert.match(icons.body, /\.ti-crown:before/);

  const font = await get('/vendor/tabler-icons/fonts/tabler-icons.woff2');
  assert.equal(font.status, 200, '图标 css 里的相对字体路径必须一起挂出来');

  const ours = await get('/style.css');
  assert.match(ours.body, /BP Display/);
});

test('路径穿越：../ 编码变形一律 404', async () => {
  for (const attempt of [
    '/app/../../../package.json',
    '/app/%2e%2e%2f%2e%2e%2fpackage.json',
    '/vendor/protocol/../../package.json',
    '/vendor/tabler/../../../package.json',
    '/games/fixture-turn/../../package.json',
  ]) {
    const { status } = await get(attempt);
    assert.equal(status, 404, `${attempt} 不该被送出去`);
  }
  const leaked = await get('/app/../../../package.json');
  assert.ok(!leaked.body.includes('"workspaces"'));
});

test('游戏模块产物可跨源取（模块下发位）', async () => {
  const { status, body, headers } = await get('/games/fixture-turn/index.js');
  assert.equal(status, 200);
  assert.match(body, /测试夹具·回合制/);
  assert.equal(headers.get('access-control-allow-origin'), '*');
});

test('真 WebSocket 经宿主壳连上并拿到 welcome', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const frames = [];
  ws.on('message', (data) => frames.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'hello', protocol: 1, nick: '测试机', gameId: 'fixture-turn', version: '0.1.0' }));
  const deadline = Date.now() + 4_000;
  while (!frames.some((f) => f.type === 'welcome') && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const welcome = frames.find((f) => f.type === 'welcome');
  assert.ok(welcome, `没拿到 welcome：${JSON.stringify(frames)}`);
  assert.deepEqual(welcome.availableGames.map((g) => g.id).sort(), ['fixture-simultaneous', 'fixture-turn']);
  ws.close();
});

test('hostd 按端口写 run-<port>.json，供 stop 精确收尾', async () => {
  const file = join(DATA_DIR, `run-${PORT}.json`);
  assert.ok(existsSync(file), '应该记录 pid 与端口');
  const record = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(record.mode, 'host');
  assert.equal(record.port, PORT);
  assert.equal(typeof record.httpPid, 'number');
});

test('hostd stop --port 能收掉对应记录（Windows 上 kill 是硬杀，不走信号处理器）', async () => {
  const file = join(DATA_DIR, `run-${PORT}.json`);
  const pid = child?.pid;
  child?.kill('SIGTERM');
  await new Promise((r) => (child?.once('close', r) ?? r()));
  child = null;
  assert.equal(existsSync(file), true, '进程被硬杀时记录要留在盘上，这正是 stop 子命令存在的理由');

  await new Promise((resolveStop) => {
    // 只收自己这个端口：另一个测试文件正在跑 join 壳，全停会把它打断
    const stop = spawn(process.execPath, [join(ROOT, 'packages', 'hostd', 'dist', 'cli.js'), 'stop', '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, BP_DATA_DIR: DATA_DIR }, stdio: 'ignore' });
    stop.once('close', () => resolveStop());
  });
  assert.equal(existsSync(file), false, 'stop 之后不该再留这个端口的记录');
  assert.ok(typeof pid === 'number');
});
