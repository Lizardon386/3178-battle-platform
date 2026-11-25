import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { WebSocket } from 'ws';
import { buildPackage, openGameRegistry } from '@bp/game-package';
import { startService } from '../dist/compose.js';

const MANIFEST = {
  id: 'tunnel-game',
  name: '隧道夹具',
  version: '1.0.0',
  platformRequirements: { protocolVersion: 1, minPlayers: 2, maxPlayers: 2 },
  entryPoints: { authority: 'authority.js', web: 'web/index.html' },
  sessionConfig: { fields: [] },
  reference: { entry: 'reference.json' },
};

function fakeSpawner() {
  const procs = [];
  return {
    procs,
    start(config, binaryPath, env) {
      const proc = new EventEmitter();
      proc.pid = 5000 + procs.length;
      proc.stdout = new PassThrough();
      proc.stderr = new PassThrough();
      proc.onExit = (listener) => proc.once('exit', listener);
      proc.kill = () => proc.emit('exit', 0, null);
      procs.push({ name: config.name, config, binaryPath, env, proc });
      const host = config.name === 'game' ? 'game-tunnel-1234.trycloudflare.com' : 'mgmt-tunnel-1234.trycloudflare.com';
      setImmediate(() => proc.stdout.write(`INF |  https://${host}  |\n`));
      return proc;
    },
  };
}

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

async function createPackage(root) {
  const source = join(root, 'source');
  await mkdir(join(source, 'web'), { recursive: true });
  await writeFile(join(source, 'authority.js'), 'module.exports = {};\n');
  await writeFile(join(source, 'web', 'index.html'), '<!doctype html><title>tunnel</title>\n');
  await writeFile(join(source, 'reference.json'), '{"name":"tunnel"}\n');
  const outFile = join(root, 'tunnel-game.bpkg');
  buildPackage({ root: source, manifest: MANIFEST, outFile });
  return outFile;
}

test('双隧道：管理与游戏各一条，gameUrl 优先用游戏公网地址', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-tunnel-game-'));
  const outFile = await createPackage(root);
  const dataDir = join(root, 'data');
  const cacheRoot = join(dataDir, 'packages');
  const spawner = fakeSpawner();
  const service = await startService({
    dataDir,
    port: 0,
    registry: openGameRegistry({ packages: [outFile], cacheRoot }),
    gameOrigin: { port: 0 },
    tunnel: { mode: 'quick', spawner, game: { mode: 'quick' } },
  });
  assert.equal(service.publicUrl, 'https://mgmt-tunnel-1234.trycloudflare.com');
  assert.equal(service.gamePublicUrl, 'https://game-tunnel-1234.trycloudflare.com');
  const names = spawner.procs.map((entry) => entry.name).sort();
  assert.deepEqual(names, ['game', 'management']);

  const host = await connectControl(service.port);
  const guest = await connectControl(service.port);
  try {
    host.send(JSON.stringify({ type: 'sessionCreate', gameId: 'tunnel-game', gameVersion: '1.0.0' }));
    const hostSeat = await waitMessage(host, (m) => m.type === 'seatGranted');
    guest.send(JSON.stringify({ type: 'sessionJoin', sessionId: hostSeat.sessionId, code: hostSeat.code }));
    await waitMessage(guest, (m) => m.type === 'seatGranted');

    host.send(JSON.stringify({ type: 'channelOpen' }));
    const granted = await waitMessage(host, (m) => m.type === 'channelGranted');
    assert.ok(granted.gameUrl.startsWith(`https://game-tunnel-1234.trycloudflare.com/s/${hostSeat.sessionId}/#handoff=`));
  } finally {
    host.close();
    guest.close();
    await service.close();
  }
  assert.equal(spawner.procs.length, 2);
});
