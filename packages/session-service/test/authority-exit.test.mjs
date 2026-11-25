import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { buildPackage, openGameRegistry } from '@bp/game-package';
import { startService } from '../dist/compose.js';

const READY_HELPER = `const net = require('node:net');
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  const index = buffer.indexOf('\\n');
  if (index < 0) return;
  const boot = JSON.parse(buffer.slice(0, index));
  const socket = net.connect(boot.ipcPort, '127.0.0.1', () => {
    const body = Buffer.from(JSON.stringify({ type: 'authorityReady', authorityEpoch: boot.epoch }));
    const frame = Buffer.alloc(4 + body.length);
    frame.writeUInt32BE(body.length, 0);
    body.copy(frame, 4);
    socket.write(frame);
    HANDLE_BOOT
  });
  socket.on('data', () => {});
  socket.on('close', () => process.exit(0));
});
`;

const manifest = (id) => ({
  id,
  name: id,
  version: '1.0.0',
  platformRequirements: { protocolVersion: 1, minPlayers: 2, maxPlayers: 2 },
  entryPoints: { authority: 'authority.js', web: 'web/index.html' },
  sessionConfig: { fields: [] },
  reference: { entry: 'reference.json' },
});

const waitOpen = (ws) => new Promise((resolvePromise, reject) => {
  ws.once('open', resolvePromise);
  ws.once('error', reject);
});

const waitMessage = (ws, predicate, timeoutMs = 10000) => new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => reject(new Error('等待消息超时')), timeoutMs);
  const onMessage = (raw, isBinary) => {
    if (isBinary) return;
    const value = JSON.parse(raw.toString());
    if (!predicate(value)) return;
    clearTimeout(timer);
    ws.off('message', onMessage);
    resolvePromise(value);
  };
  ws.on('message', onMessage);
});

const connectControl = async (port) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/control`);
  await waitOpen(ws);
  ws.send(JSON.stringify({ type: 'hello' }));
  await waitMessage(ws, (m) => m.type === 'welcome');
  return ws;
};

async function createPackage(root, id, handleBoot) {
  const source = join(root, `${id}-source`);
  await mkdir(join(source, 'web'), { recursive: true });
  await writeFile(join(source, 'authority.js'), READY_HELPER.replace('HANDLE_BOOT', handleBoot));
  await writeFile(join(source, 'web', 'index.html'), '<!doctype html><title>exit</title>\n');
  await writeFile(join(source, 'reference.json'), '{"name":"exit"}\n');
  const outFile = join(root, `${id}.bpkg`);
  buildPackage({ root: source, manifest: manifest(id), outFile });
  return outFile;
}

async function startSession(service, gameId) {
  const host = await connectControl(service.port);
  const guest = await connectControl(service.port);
  host.send(JSON.stringify({ type: 'sessionCreate', gameId, gameVersion: '1.0.0' }));
  const hostSeat = await waitMessage(host, (m) => m.type === 'seatGranted');
  guest.send(JSON.stringify({ type: 'sessionJoin', sessionId: hostSeat.sessionId, code: hostSeat.code }));
  await waitMessage(guest, (m) => m.type === 'seatGranted');
  await waitMessage(host, (m) => m.type === 'sessionState' && m.session.members.length === 2);
  return { host, guest, sessionId: hostSeat.sessionId };
}

test('Authority 意外退出：会话标记 failed 并广播', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-authority-exit-'));
  const outFile = await createPackage(root, 'crash-game', 'setTimeout(() => process.exit(3), 150);');
  const dataDir = join(root, 'data');
  const service = await startService({
    dataDir,
    port: 0,
    registry: openGameRegistry({ packages: [outFile], cacheRoot: join(dataDir, 'packages') }),
  });
  const { host, guest } = await startSession(service, 'crash-game');
  try {
    host.send(JSON.stringify({ type: 'startGame' }));
    const failed = await waitMessage(host, (m) => m.type === 'sessionState' && m.session.gameProcess === 'failed');
    assert.equal(failed.session.gameProcess, 'failed');
  } finally {
    host.close();
    guest.close();
    await service.close();
  }
});

test('关闭会话会停止 Authority 进程', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-authority-close-'));
  const outFile = await createPackage(root, 'close-game', `
    const fs = require('node:fs');
    const path = require('node:path');
    fs.mkdirSync(boot.stateDir, { recursive: true });
    fs.writeFileSync(path.join(boot.stateDir, 'pid'), String(process.pid));
  `);
  const dataDir = join(root, 'data');
  const service = await startService({
    dataDir,
    port: 0,
    registry: openGameRegistry({ packages: [outFile], cacheRoot: join(dataDir, 'packages') }),
  });
  const { host, guest, sessionId } = await startSession(service, 'close-game');
  try {
    host.send(JSON.stringify({ type: 'startGame' }));
    await waitMessage(host, (m) => m.type === 'sessionState' && m.session.gameProcess === 'running');

    const pidFile = join(dataDir, 'authority', sessionId, 'round-1', 'pid');
    let pid = null;
    for (let index = 0; index < 100 && pid === null; index += 1) {
      try {
        pid = Number(await readFile(pidFile, 'utf8'));
      } catch {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      }
    }
    assert.ok(pid, 'Authority 没有写出 pid');

    host.send(JSON.stringify({ type: 'sessionClose' }));
    let gone = false;
    for (let index = 0; index < 100; index += 1) {
      try {
        process.kill(pid, 0);
      } catch {
        gone = true;
        break;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }
    assert.equal(gone, true, 'Authority 进程仍在运行');
  } finally {
    host.close();
    guest.close();
    await service.close();
  }
});
