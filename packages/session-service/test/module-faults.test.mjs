import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { buildPackage, openGameRegistry } from '@bp/game-package';
import { startService } from '../dist/compose.js';

const runnerPath = join(process.cwd(), 'packages', 'session-service', 'dist', 'authority-runner.js');

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

async function badModulePackage(root) {
  const source = join(root, 'source');
  await mkdir(join(source, 'authority'), { recursive: true });
  await mkdir(join(source, 'web'), { recursive: true });
  await writeFile(join(source, 'authority', 'index.js'), 'module.exports = {};\n');
  await writeFile(join(source, 'web', 'index.html'), '<!doctype html><title>bad module</title>\n');
  await writeFile(join(source, 'reference.json'), '{"name":"bad"}\n');
  const outFile = join(root, 'bad-module.bpkg');
  buildPackage({
    root: source,
    manifest: {
      id: 'bad-module',
      name: '坏模块',
      version: '1.0.0',
      authorityModel: 'module',
      platformRequirements: { protocolVersion: 1, minPlayers: 2, maxPlayers: 2 },
      entryPoints: { authority: 'authority/index.js', web: 'web/index.html' },
      sessionConfig: { fields: [] },
      reference: { entry: 'reference.json' },
    },
    outFile,
  });
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
  return { host, guest };
}

test('module 入口缺少 createAuthority：会话 failed，Service 仍存活', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-module-bad-'));
  const outFile = await badModulePackage(root);
  const dataDir = join(root, 'data');
  const service = await startService({
    dataDir,
    port: 0,
    registry: openGameRegistry({ packages: [outFile], cacheRoot: join(dataDir, 'packages') }),
    authorityRunnerPath: runnerPath,
    autoRestartAttempts: 0,
  });
  const { host, guest } = await startSession(service, 'bad-module');
  try {
    const errorPromise = waitMessage(host, (m) => m.type === 'error');
    const failedPromise = waitMessage(host, (m) => m.type === 'sessionState' && m.session.gameProcess === 'failed');
    host.send(JSON.stringify({ type: 'startGame' }));
    const error = await errorPromise;
    assert.equal(error.code, 'GAMEFAILED');
    await failedPromise;

    const pong = waitMessage(host, (m) => m.type === 'pong');
    host.send(JSON.stringify({ type: 'ping', nonce: 'alive' }));
    assert.equal((await pong).nonce, 'alive');
  } finally {
    host.close();
    guest.close();
    await service.close();
  }
});

test('module 包缺少 runner：startGame 返回 GAMEFAILED，且不 spawn 子进程', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-module-norunner-'));
  const outFile = await badModulePackage(root);
  const dataDir = join(root, 'data');
  const spawned = [];
  const service = await startService({
    dataDir,
    port: 0,
    registry: openGameRegistry({ packages: [outFile], cacheRoot: join(dataDir, 'packages') }),
    onAuthorityStart: (info) => spawned.push(info),
    autoRestartAttempts: 0,
  });
  const { host, guest } = await startSession(service, 'bad-module');
  try {
    const errorPromise = waitMessage(host, (m) => m.type === 'error');
    const failedPromise = waitMessage(host, (m) => m.type === 'sessionState' && m.session.gameProcess === 'failed');
    host.send(JSON.stringify({ type: 'startGame' }));
    assert.equal((await errorPromise).code, 'GAMEFAILED');
    await failedPromise;
    assert.equal(spawned.length, 0);
  } finally {
    host.close();
    guest.close();
    await service.close();
  }
});
