import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { buildPackage, openGameRegistry } from '@bp/game-package';
import { startService } from '../dist/compose.js';

const AUTHORITY = `const net = require('node:net');
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  const index = buffer.indexOf('\\n');
  if (index < 0) return;
  const boot = JSON.parse(buffer.slice(0, index));
  const socket = net.connect(boot.ipcPath, () => {
    const body = Buffer.from(JSON.stringify({ type: 'authorityReady', authorityEpoch: boot.epoch }));
    const frame = Buffer.alloc(4 + body.length);
    frame.writeUInt32BE(body.length, 0);
    body.copy(frame, 4);
    socket.write(frame);
  });
  socket.on('data', () => {});
  socket.on('close', () => process.exit(0));
});
`;

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

test('服务重启：遗留 running 会话对账为 failed，可再由房主恢复', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-orphan-'));
  const source = join(root, 'source');
  await mkdir(join(source, 'web'), { recursive: true });
  await writeFile(join(source, 'authority.js'), AUTHORITY);
  await writeFile(join(source, 'web', 'index.html'), '<!doctype html><title>orphan</title>\n');
  await writeFile(join(source, 'reference.json'), '{"name":"orphan"}\n');
  const outFile = join(root, 'orphan.bpkg');
  buildPackage({
    root: source,
    manifest: {
      id: 'orphan-game',
      name: '对账夹具',
      version: '1.0.0',
      platformRequirements: { protocolVersion: 1, minPlayers: 2, maxPlayers: 2 },
      entryPoints: { authority: 'authority.js', web: 'web/index.html' },
      sessionConfig: { fields: [] },
      reference: { entry: 'reference.json' },
    },
    outFile,
  });
  const dataDir = join(root, 'data');
  const cacheRoot = join(dataDir, 'packages');
  const registry = () => openGameRegistry({ packages: [outFile], cacheRoot });

  const first = await startService({ dataDir, port: 0, registry: registry() });
  const host = await connectControl(first.port);
  const guest = await connectControl(first.port);
  let resumeToken;
  let sessionId;
  try {
    host.send(JSON.stringify({ type: 'sessionCreate', gameId: 'orphan-game', gameVersion: '1.0.0' }));
    const hostSeat = await waitMessage(host, (m) => m.type === 'seatGranted');
    sessionId = hostSeat.sessionId;
    resumeToken = hostSeat.resumeToken;
    guest.send(JSON.stringify({ type: 'sessionJoin', sessionId, code: hostSeat.code }));
    await waitMessage(guest, (m) => m.type === 'seatGranted');
    await waitMessage(host, (m) => m.type === 'sessionState' && m.session.members.length === 2);
    host.send(JSON.stringify({ type: 'startGame' }));
    await waitMessage(host, (m) => m.type === 'sessionState' && m.session.gameProcess === 'running');
  } finally {
    host.close();
    guest.close();
    await first.close();
  }

  const second = await startService({ dataDir, port: 0, registry: registry() });
  const resumed = await connectControl(second.port);
  try {
    const seat = waitMessage(resumed, (m) => m.type === 'seatGranted');
    const statePromise = waitMessage(resumed, (m) => m.type === 'sessionState' && m.session.sessionId === sessionId);
    resumed.send(JSON.stringify({ type: 'sessionResume', sessionId, resumeToken }));
    await seat;
    const state = await statePromise;
    assert.equal(state.session.gameProcess, 'failed');

    const recoveredPromise = waitMessage(resumed, (m) => m.type === 'sessionState' && m.session.gameProcess === 'running');
    resumed.send(JSON.stringify({ type: 'recoverGame' }));
    const recovered = await recoveredPromise;
    assert.equal(recovered.session.authorityEpoch, 2);
  } finally {
    resumed.close();
    await second.close();
  }
});
