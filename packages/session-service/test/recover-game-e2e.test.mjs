import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { buildGamePackage } from '@lizardon386/bp-game';
import { openGameRegistry } from '@bp/game-package';
import { decodeFrame, encodeFrame } from '@bp/session-ws';
import { startService } from '../dist/compose.js';

const referenceRoot = fileURLToPath(new URL('../../../examples/reference-duel', import.meta.url));

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

const waitFrame = (ws, predicate, timeoutMs = 10000) => new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => reject(new Error('等待游戏帧超时')), timeoutMs);
  const onMessage = (raw, isBinary) => {
    if (!isBinary) return;
    const payload = JSON.parse(decodeFrame(raw).payload.toString());
    if (!predicate(payload)) return;
    clearTimeout(timer);
    ws.off('message', onMessage);
    resolvePromise(payload);
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

const openChannel = async (control) => {
  const grantedPromise = waitMessage(control, (m) => m.type === 'channelGranted');
  control.send(JSON.stringify({ type: 'channelOpen' }));
  return grantedPromise;
};

const openGameData = async (gamePort, handoffCode) => {
  const ws = new WebSocket(`ws://127.0.0.1:${gamePort}/ws/data`);
  await waitOpen(ws);
  ws.send(JSON.stringify({ kind: 'data', handoffCode }));
  const ready = await waitMessage(ws, (m) => m.type === 'dataReady');
  return { ws, channelId: ready.channelId };
};

test('Authority 崩溃后 recoverGame 用新 epoch 恢复检查点', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-recover-'));
  const dataDir = join(root, 'data');
  const outFile = join(root, 'reference-duel.bpkg');
  await buildGamePackage({ root: referenceRoot, outFile, stageDir: join(root, 'stage') });

  const spawned = [];
  const service = await startService({
    dataDir,
    port: 0,
    registry: openGameRegistry({ packages: [outFile], cacheRoot: join(dataDir, 'packages') }),
    gameOrigin: { port: 0 },
    onAuthorityStart: (info) => spawned.push(info),
    autoRestartAttempts: 0,
  });
  const host = await connectControl(service.port);
  const guest = await connectControl(service.port);
  try {
    host.send(JSON.stringify({ type: 'sessionCreate', gameId: 'reference-duel', gameVersion: '1.0.0' }));
    const hostSeat = await waitMessage(host, (m) => m.type === 'seatGranted');
    guest.send(JSON.stringify({ type: 'sessionJoin', sessionId: hostSeat.sessionId, code: hostSeat.code }));
    const guestSeat = await waitMessage(guest, (m) => m.type === 'seatGranted');
    await waitMessage(host, (m) => m.type === 'sessionState' && m.session.members.length === 2);

    const hostChannel = await openChannel(host);
    const guestChannel = await openChannel(guest);
    const hostData = await openGameData(service.gamePort, hostChannel.handoffCode);
    const guestData = await openGameData(service.gamePort, guestChannel.handoffCode);

    const hostPrivate = waitFrame(hostData.ws, (p) => p.type === 'private');
    host.send(JSON.stringify({ type: 'startGame' }));
    await waitMessage(host, (m) => m.type === 'sessionState' && m.session.gameProcess === 'running');
    const initial = await hostPrivate;
    assert.equal(initial.view.turnNumber, 1);
    assert.equal(initial.view.hand.length, 4);
    assert.equal(spawned.length, 1);

    const nextTurn = waitFrame(guestData.ws, (p) => p.type === 'public' && p.view.turnNumber === 2);
    const payload = Buffer.from(JSON.stringify({ action: { type: 'play', cardId: initial.view.hand[0].id } }));
    hostData.ws.send(encodeFrame({
      v: 1, channelId: hostData.channelId, to: 'all', seq: 1, mode: 'reliable', payloadBytes: payload.byteLength,
    }, payload));
    await nextTurn;

    process.kill(spawned[0].pid);
    await waitMessage(host, (m) => m.type === 'sessionState' && m.session.gameProcess === 'failed', 10000);

    const restoredPrivate = waitFrame(hostData.ws, (p) => p.type === 'private' && p.view.turnNumber === 2, 10000);
    host.send(JSON.stringify({ type: 'recoverGame' }));
    const running = await waitMessage(host, (m) => m.type === 'sessionState' && m.session.gameProcess === 'running', 10000);
    assert.equal(running.session.authorityEpoch, 2);
    assert.equal(spawned.length, 2);
    assert.notEqual(spawned[0].pid, spawned[1].pid);

    const restored = await restoredPrivate;
    assert.equal(restored.view.you, hostSeat.memberId);
    assert.equal(restored.view.hand.length, 3);
    assert.equal(restored.view.currentMemberId, guestSeat.memberId);
  } finally {
    host.close();
    guest.close();
    await service.close();
  }
});
