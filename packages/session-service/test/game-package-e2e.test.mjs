import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { buildPackage, openGameRegistry } from '@bp/game-package';
import { startService } from '../dist/compose.js';

const waitOpen = (ws) => new Promise((resolvePromise, reject) => {
  ws.once('open', resolvePromise);
  ws.once('error', reject);
});

const waitMessage = (ws, predicate, timeoutMs = 8000) => new Promise((resolvePromise, reject) => {
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

const FIXTURE_AUTHORITY = `const net = require('node:net');
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
  });
  socket.on('data', () => {});
  socket.on('close', () => process.exit(0));
});
`;

const FIXTURE_MANIFEST = {
  id: 'fixture-game',
  name: '夹具游戏',
  version: '1.0.0',
  platformRequirements: { protocolVersion: 1, minPlayers: 2, maxPlayers: 4 },
  entryPoints: { authority: 'authority.js', web: 'web/index.html' },
  sessionConfig: { fields: [] },
  reference: { entry: 'reference.json' },
};

async function createPackage(root) {
  await mkdir(join(root, 'source', 'web'), { recursive: true });
  await writeFile(join(root, 'source', 'authority.js'), FIXTURE_AUTHORITY);
  await writeFile(join(root, 'source', 'web', 'index.html'), '<!doctype html><title>fixture game</title><div id="app"></div>\n');
  await writeFile(join(root, 'source', 'web', 'main.js'), 'globalThis.fixture = true;\n');
  await writeFile(join(root, 'source', 'reference.json'), '{"name":"fixture"}\n');
  const outFile = join(root, 'fixture-game.bpkg');
  buildPackage({ root: join(root, 'source'), manifest: FIXTURE_MANIFEST, outFile });
  return outFile;
}

test('游戏包注册、独立游戏 origin 与 Authority 启动', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-game-package-e2e-'));
  const dataDir = join(root, 'data');
  const outFile = await createPackage(root);
  const registry = openGameRegistry({ packages: [outFile], cacheRoot: join(dataDir, 'packages') });

  const service = await startService({ dataDir, port: 0, registry, gameOrigin: { port: 0 } });
  assert.ok(service.gamePort);
  assert.notEqual(service.gamePort, service.port);

  const host = await connectControl(service.port);
  const guest = await connectControl(service.port);
  try {
    host.send(JSON.stringify({ type: 'sessionCreate', gameId: 'fixture-game', gameVersion: '1.0.0', title: '包链路' }));
    const hostSeat = await waitMessage(host, (m) => m.type === 'seatGranted');
    guest.send(JSON.stringify({ type: 'sessionJoin', sessionId: hostSeat.sessionId, code: hostSeat.code }));
    await waitMessage(guest, (m) => m.type === 'seatGranted');
    await waitMessage(host, (m) => m.type === 'sessionState' && m.session.members.length === 2);

    host.send(JSON.stringify({ type: 'channelOpen' }));
    const granted = await waitMessage(host, (m) => m.type === 'channelGranted');
    assert.equal(granted.gameUrl, `http://127.0.0.1:${service.gamePort}/s/${hostSeat.sessionId}/`);

    const page = await fetch(granted.gameUrl);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.equal(page.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.match(await page.text(), /fixture game/);

    const asset = await fetch(`${granted.gameUrl}main.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /javascript/);

    const missing = await fetch(`http://127.0.0.1:${service.gamePort}/s/unknown-session/`);
    assert.equal(missing.status, 404);

    const traversal = await fetch(`http://127.0.0.1:${service.gamePort}/s/${hostSeat.sessionId}/..%5c..%5cpackage.json`);
    assert.equal(traversal.status, 404);

    host.send(JSON.stringify({ type: 'startGame' }));
    await waitMessage(host, (m) => m.type === 'sessionState' && m.session.gameProcess === 'running', 10000);

    const data = new WebSocket(`ws://127.0.0.1:${service.gamePort}/ws/data`);
    await waitOpen(data);
    data.send(JSON.stringify({ kind: 'data', channelToken: granted.channelToken }));
    await waitMessage(data, (m) => m.type === 'dataReady');
    data.close();

    const rejected = await new Promise((resolvePromise) => {
      const bad = new WebSocket(`ws://127.0.0.1:${service.gamePort}/ws/data`, { origin: 'http://evil.example' });
      bad.on('unexpected-response', (_request, response) => {
        response.resume();
        resolvePromise(response.statusCode);
      });
      bad.on('open', () => {
        bad.close();
        resolvePromise('open');
      });
      bad.on('error', () => resolvePromise('error'));
    });
    assert.equal(rejected, 403);
  } finally {
    host.close();
    guest.close();
    await service.close();
  }
});
