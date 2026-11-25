import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { isLoopbackAddress, isLoopbackHost } from '@bp/session-ws';
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

const connect = async (port, options) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/control`, options);
  await waitOpen(ws);
  ws.send(JSON.stringify({ type: 'hello' }));
  await waitMessage(ws, (m) => m.type === 'welcome');
  return ws;
};

test('回环判断：只认 127.0.0.1/localhost/[::1]', () => {
  assert.equal(isLoopbackHost('127.0.0.1:3178'), true);
  assert.equal(isLoopbackHost('localhost:3178'), true);
  assert.equal(isLoopbackHost('[::1]:3178'), true);
  assert.equal(isLoopbackHost('game.example.com'), false);
  assert.equal(isLoopbackHost('192.168.1.20:3178'), false);
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('10.0.0.2'), false);
});

test('非回环 Host 拒绝 sessionCreate 与 listGames', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-local-scope-'));
  const source = join(root, 'source');
  await mkdir(join(source, 'web'), { recursive: true });
  await writeFile(join(source, 'authority.js'), 'module.exports = {};\n');
  await writeFile(join(source, 'web', 'index.html'), '<!doctype html><title>local</title>\n');
  await writeFile(join(source, 'reference.json'), '{"name":"local"}\n');
  const outFile = join(root, 'local.bpkg');
  buildPackage({
    root: source,
    manifest: {
      id: 'local-game',
      name: '本机夹具',
      version: '1.0.0',
      platformRequirements: { protocolVersion: 1, minPlayers: 2, maxPlayers: 2 },
      entryPoints: { authority: 'authority.js', web: 'web/index.html' },
      sessionConfig: { fields: [] },
      reference: { entry: 'reference.json' },
    },
    outFile,
  });
  const dataDir = join(root, 'data');
  const service = await startService({
    dataDir,
    port: 0,
    registry: openGameRegistry({ packages: [outFile], cacheRoot: join(dataDir, 'packages') }),
  });
  const local = await connect(service.port);
  const remote = await connect(service.port, { headers: { host: 'game.example.com' } });
  try {
    local.send(JSON.stringify({ type: 'listGames' }));
    const games = await waitMessage(local, (m) => m.type === 'gameList');
    assert.equal(games.games.length, 1);

    remote.send(JSON.stringify({ type: 'listGames' }));
    const listError = await waitMessage(remote, (m) => m.type === 'error');
    assert.equal(listError.code, 'FORBIDDEN');

    remote.send(JSON.stringify({ type: 'sessionCreate', gameId: 'local-game', gameVersion: '1.0.0' }));
    const createError = await waitMessage(remote, (m) => m.type === 'error');
    assert.equal(createError.code, 'FORBIDDEN');

    local.send(JSON.stringify({ type: 'sessionCreate', gameId: 'local-game', gameVersion: '1.0.0' }));
    await waitMessage(local, (m) => m.type === 'seatGranted');
  } finally {
    local.close();
    remote.close();
    await service.close();
  }
});
