import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

/** 单入口壳：启动只开本机口；建房时才开局域网监听与落盘。 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLI = join(ROOT, 'packages', 'hostd', 'dist', 'cli.js');
const TEMP_ROOT = mkdtempSync(join(tmpdir(), 'bp-single-shell-'));
const DATA_DIR = join(TEMP_ROOT, 'data');

function reservePort(host) {
  return new Promise((res, rej) => {
    const server = createServer();
    server.once('error', rej);
    server.listen(0, host, () => {
      const port = server.address().port;
      res({ port, release: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

async function waitHealth(port, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(400) });
      if (response.ok) return response;
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`端口 ${port} 的 /health 没起来`);
}

function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const frames = [];
  ws.on('message', (data) => frames.push(JSON.parse(data.toString())));
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
    send(message) {
      ws.send(JSON.stringify(message));
    },
  };
}

test('单入口壳：纯进房不写 data，建房才开 LAN 并共享同一个引擎', async () => {
  const ui = await reservePort('127.0.0.1');
  const lan = await reservePort('0.0.0.0');
  const uiPort = ui.port;
  const lanPort = lan.port;
  await ui.release();
  await lan.release();
  const child = spawn(process.execPath, [CLI, 'shell', '--port', String(uiPort), '--lan-port', String(lanPort), '--no-announce'], {
    cwd: ROOT,
    env: { ...process.env, BP_DATA_DIR: DATA_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => (log += b.toString()));
  child.stderr.on('data', (b) => (log += b.toString()));
  let roomCode = null;
  try {
    await waitHealth(uiPort);
    assert.equal(existsSync(DATA_DIR), false, '纯进房壳不该创建 data/');

    const before = await (await fetch(`http://127.0.0.1:${uiPort}/api/self`)).json();
    assert.equal(before.publicOrigin, null, '建房前没有可发给朋友的地址');

    const readyResponse = await fetch(`http://127.0.0.1:${uiPort}/api/host/ready`, { method: 'POST' });
    const ready = await readyResponse.json();
    assert.equal(ready.ok, true, JSON.stringify(ready));
    assert.match(ready.publicOrigin, new RegExp(`:${lanPort}$`));
    assert.doesNotMatch(ready.publicOrigin, /127\.0\.0\.1|localhost/, '邀请链接必须是局域网地址');
    await waitHealth(lanPort);
    assert.equal(existsSync(DATA_DIR), true, '建房后才有落盘目录');

    const host = connect(uiPort);
    await host.hello('单入口房主');
    host.send({ type: 'roomCreate', gameId: 'fixture-turn', roomName: '单入口验收', seatSlots: 2, config: {} });
    const granted = await host.until('seatGranted');
    assert.equal(granted.role, 'host');
    const snapshot = await host.until('snapshot');
    roomCode = snapshot.room.code;

    const guest = connect(lanPort);
    await guest.hello('单入口客人');
    guest.send({ type: 'roomJoin', code: roomCode });
    const guestSeat = await guest.until('seatGranted');
    assert.equal(guestSeat.role, 'player');
    const guestSnap = await guest.until('snapshot', 4000, (m) => m.room?.code === roomCode);
    assert.ok(guestSnap.seats.some((s) => s.name === '单入口房主'), '局域网客人看到同一张桌子');
    assert.ok(readdirSync(DATA_DIR).some((name) => name === `room-${roomCode}.json`), '建房后房间落盘');

    host.ws.close();
    guest.ws.close();
  } finally {
    const gone = new Promise((r) => child.once('close', r));
    child.kill('SIGTERM');
    await gone;
    spawnSync(process.execPath, [CLI, 'stop', '--port', String(uiPort)], {
      cwd: ROOT,
      env: { ...process.env, BP_DATA_DIR: DATA_DIR },
      stdio: 'ignore',
    });
    if (roomCode) rmSync(join(DATA_DIR, `room-${roomCode}.json`), { force: true });
    rmSync(TEMP_ROOT, { recursive: true, force: true });
  }
  assert.ok(log.length >= 0);
});
