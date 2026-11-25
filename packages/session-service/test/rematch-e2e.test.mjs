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
  const granted = waitMessage(control, (m) => m.type === 'channelGranted');
  control.send(JSON.stringify({ type: 'channelOpen' }));
  return granted;
};

const openGameData = async (gamePort, handoffCode) => {
  const ws = new WebSocket(`ws://127.0.0.1:${gamePort}/ws/data`);
  await waitOpen(ws);
  ws.send(JSON.stringify({ kind: 'data', handoffCode }));
  const ready = await waitMessage(ws, (m) => m.type === 'dataReady');
  return { ws, channelId: ready.channelId };
};

test('房主再来一局：同进程开 round-2，双方收到新局视图', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-rematch-'));
  const dataDir = join(root, 'data');
  const outFile = join(root, 'reference-duel.bpkg');
  await buildGamePackage({ root: referenceRoot, outFile, stageDir: join(root, 'stage') });

  const service = await startService({
    dataDir,
    port: 0,
    registry: openGameRegistry({ packages: [outFile], cacheRoot: join(dataDir, 'packages') }),
    gameOrigin: { port: 0 },
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

    const initialPrivate = waitFrame(hostData.ws, (p) => p.type === 'private' && !p.view.finished);
    host.send(JSON.stringify({ type: 'startGame' }));
    await waitMessage(host, (m) => m.type === 'sessionState' && m.session.gameProcess === 'running');
    const first = await initialPrivate;
    assert.equal(first.view.turnNumber, 1);

    const finished = waitFrame(guestData.ws, (p) => p.type === 'public' && p.view.finished);
    const concede = Buffer.from(JSON.stringify({ action: { type: 'concede' } }));
    hostData.ws.send(encodeFrame({
      v: 1, channelId: hostData.channelId, to: 'all', seq: 1, mode: 'reliable', payloadBytes: concede.byteLength,
    }, concede));
    await finished;

    const nextPrivate = waitFrame(hostData.ws, (p) => p.type === 'private' && p.view.turnNumber === 1 && !p.view.finished);
    const nextPublic = waitFrame(guestData.ws, (p) => p.type === 'public' && p.view.turnNumber === 1 && !p.view.finished);
    host.send(JSON.stringify({ type: 'rematch' }));
    const session = await waitMessage(host, (m) => m.type === 'sessionState' && m.session.currentRoundId === 'round-2');
    assert.equal(session.session.authorityEpoch, 1);
    const [again, publicAgain] = await Promise.all([nextPrivate, nextPublic]);
    assert.equal(again.view.you, hostSeat.memberId);
    assert.equal(again.view.hand.length, 4);
    assert.equal(publicAgain.view.currentMemberId, hostSeat.memberId);
    assert.equal(publicAgain.view.turnNumber, 1);
  } finally {
    host.close();
    guest.close();
    await service.close();
  }
});
