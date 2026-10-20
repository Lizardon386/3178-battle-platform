import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

/**
 * 一个进程、两个监听、同一个 Engine：
 * 本机页面在 127.0.0.1:UI 建房，局域网玩家从 0.0.0.0:LAN 进来，必须看到同一张桌子。
 * 这是"唯一本机入口"的核心不变式——只把端口拼起来不算数，状态得真的共享。
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLI = join(ROOT, 'packages', 'hostd', 'dist', 'cli.js');

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => res(port));
    });
  });
}

function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
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
    async until(type, timeoutMs = 4000, predicate = () => true) {
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

async function waitHealth(port, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(400) });
      if (res.ok) return res;
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`端口 ${port} 的 /health 没起来`);
}

test('本机界面建房、局域网口进房：两个监听共享同一个引擎', async () => {
  const uiPort = await freePort();
  const lanPort = await freePort();
  const runFile = join(ROOT, 'data', `run-${uiPort}.json`);
  if (existsSync(runFile)) rmSync(runFile);

  // --no-announce：保留局域网监听，但不碰组播，测试不去动网卡
  const child = spawn(process.execPath, [CLI, 'host', '--port', String(uiPort), '--lan-port', String(lanPort), '--no-announce'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => (log += b.toString()));
  child.stderr.on('data', (b) => (log += b.toString()));

  let roomCode = null;
  try {
    await waitHealth(uiPort);
    await waitHealth(lanPort);

    const selfResponse = await fetch(`http://127.0.0.1:${uiPort}/api/self`);
    const self = await selfResponse.json();
    assert.match(self.publicOrigin, new RegExp(`:${lanPort}$`), `邀请链接该指向局域网口：${JSON.stringify(self)}`);
    assert.doesNotMatch(self.publicOrigin, /127\.0\.0\.1|localhost/, '邀请链接不能用本机回环地址');

    const host = connect(uiPort);
    await host.hello('本机房主');
    host.send({ type: 'roomCreate', gameId: 'echo', roomName: '双口同房', seatSlots: 3, config: { range: 6, target: 2, turnMs: 20000 } });
    const granted = await host.until('seatGranted');
    assert.equal(granted.role, 'host');
    const firstSnapshot = await host.until('snapshot');
    roomCode = firstSnapshot.room.code;
    assert.ok(roomCode, '建房后要拿到房号');

    const guest = connect(lanPort);
    await guest.hello('局域网客人');
    guest.send({ type: 'roomJoin', code: roomCode });
    const guestSeat = await guest.until('seatGranted');
    assert.equal(guestSeat.role, 'player');
    const guestSnapshot = await guest.until('snapshot', 4000, (m) => m.room?.code === roomCode && m.seats?.some((s) => s.name === '局域网客人'));
    assert.equal(guestSnapshot.room.code, roomCode);
    assert.ok(guestSnapshot.seats.some((s) => s.name === '本机房主'), '客人必须能看到从本机口建的房主');

    host.ws.close();
    guest.ws.close();
  } finally {
    const gone = new Promise((r) => child.once('close', r));
    child.kill('SIGTERM');
    await gone;

    // 按**局域网端口**也必须找得到同一个壳：用户记得住的往往是 3000
    spawnSync(process.execPath, [CLI, 'stop', '--port', String(lanPort)], { cwd: ROOT, stdio: 'ignore' });
    assert.equal(existsSync(runFile), false, `stop --port ${lanPort} 应该收掉本机口 ${uiPort} 的记录`);
    if (roomCode) rmSync(join(ROOT, 'data', `room-${roomCode}.json`), { force: true });
  }
  assert.ok(log.length >= 0);
});
