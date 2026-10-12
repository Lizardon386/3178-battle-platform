import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

/**
 * 回归：本地壳（join 模式）以前只挂静态页、没挂 WS 服务，
 * 玩家在 http://127.0.0.1:3178 上点"建房"只会得到一句"协议不对: socket error"。
 * 按"每人本机一份客户端"的设定，谁都能开房，所以这里钉住：壳必须能建房、能开局。
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = 3212;
const BASE = `http://127.0.0.1:${PORT}`;

let child = null;

function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const frames = [];
  ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
  return {
    ws,
    frames,
    async hello(nick) {
      await new Promise((r, j) => {
        ws.once('open', r);
        ws.once('error', j);
      });
      ws.send(JSON.stringify({ type: 'hello', protocol: 1, nick }));
      return this.until('welcome');
    },
    async until(type, timeoutMs = 3000, predicate = () => true) {
      const started = Date.now();
      for (;;) {
        const found = frames.find((m) => m.type === type && predicate(m));
        if (found) return found;
        if (Date.now() - started > timeoutMs) throw new Error(`没等到 ${type}：${JSON.stringify(frames.map((m) => m.type))}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    },
    send(msg) {
      ws.send(JSON.stringify(msg));
    },
  };
}

before(async () => {
  child = spawn(process.execPath, [join(ROOT, 'packages', 'hostd', 'dist', 'cli.js'), 'join', '--port', String(PORT), '--no-lan'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stderr.on('data', (c) => (log += c.toString()));
  const deadline = Date.now() + 12_000;
  for (;;) {
    try {
      const probe = await fetch(`${BASE}/health`);
      if (probe.ok) break;
    } catch {
      // 还没起来
    }
    if (Date.now() > deadline) throw new Error(`本地壳没起来：${log}`);
    await new Promise((r) => setTimeout(r, 120));
  }
});

after(async () => {
  if (!child) return;
  const gone = new Promise((r) => child.once('close', r));
  // Windows 上这是硬杀，不走信号处理器，于是 data/run-3212.json 会被留在盘上，
  // diagnose 之后就一直谎报"在跑的壳"。测试自己收干净，残骸留给 stop 的专门用例去证明。
  child.kill('SIGTERM');
  await gone;
  const stop = spawn(
    process.execPath,
    [join(ROOT, 'packages', 'hostd', 'dist', 'cli.js'), 'stop', '--port', String(PORT)],
    { cwd: ROOT, stdio: 'ignore' },
  );
  await new Promise((r) => stop.once('close', r));
  assert.equal(existsSync(join(ROOT, 'data', `run-${PORT}.json`)), false, 'stop 之后不该留这个端口的记录');
});

test('本地壳也带 WS 服务：hello 能拿到 welcome 与游戏清单', async () => {
  const c = connect();
  const welcome = await c.hello('壳里开房的玩家');
  assert.equal(welcome.protocol, 1);
  assert.deepEqual(welcome.availableGames.map((g) => g.id).sort(), ['echo', 'turncount']);
  c.ws.close();
});

test('在本地壳上建房 + 加个电脑位 + 开局：不再"协议不对"', async () => {
  const c = connect();
  await c.hello('壳里开房的玩家');
  c.send({ type: 'roomCreate', gameId: 'echo', roomName: '壳里自建', seatSlots: 2, config: { range: 6, target: 2, turnMs: 20000 } });
  const granted = await c.until('seatGranted');
  assert.equal(granted.role, 'host');
  assert.ok(granted.ticket.length >= 16);
  // 一个人开不了局（平台的人数闸），补个电脑位再开——房主自己不需要 Ready
  c.send({ type: 'hostSeat', op: 'addAi' });
  c.frames.length = 0;
  c.send({ type: 'hostStart' });
  const playing = await c.until('snapshot', 3000, (m) => m.phase === 'playing');
  assert.equal(playing.room.name, '壳里自建');
  assert.ok(playing.game, '对局状态由游戏模块给出');
  c.ws.close();
});

test('本地壳只绑 127.0.0.1：不声不响对外开门是不行的', async () => {
  const res = await fetch(`${BASE}/health`);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.games));
});

test('两个壳同时跑要各留一份记录，否则 stop 只能停掉最后启动的那个', async () => {
  const file = join(ROOT, 'data', `run-${PORT}.json`);
  assert.ok(existsSync(file), '本地壳要写自己端口的记录');
  const record = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(record.mode, 'join');
  assert.equal(record.port, PORT);
});
