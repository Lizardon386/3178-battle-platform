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

const waitFrame = (ws, predicate, timeoutMs = 10000, label = 'frame') => new Promise((resolvePromise, reject) => {
  const seen = [];
  const timer = setTimeout(() => reject(new Error(`等待游戏帧超时（${label}）：${JSON.stringify(seen)}`)), timeoutMs);
  const onMessage = (raw, isBinary) => {
    if (!isBinary) return;
    const frame = decodeFrame(raw);
    const payload = JSON.parse(frame.payload.toString());
    seen.push({ type: payload.type, turn: payload.view?.turnNumber });
    if (!predicate(payload)) return;
    clearTimeout(timer);
    ws.off('message', onMessage);
    resolvePromise({ frame, payload });
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

test('打包后的 reference-duel：注册、页面、交接与真实对局', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-packaged-reference-'));
  const dataDir = join(root, 'data');
  const outFile = join(root, 'reference-duel.bpkg');
  await buildGamePackage({ root: referenceRoot, outFile, stageDir: join(root, 'stage') });

  const registry = openGameRegistry({ packages: [outFile], cacheRoot: join(dataDir, 'packages') });
  const service = await startService({ dataDir, port: 0, registry, gameOrigin: { port: 0 } });
  const host = await connectControl(service.port);
  const guest = await connectControl(service.port);
  try {
    host.send(JSON.stringify({ type: 'sessionCreate', gameId: 'reference-duel', gameVersion: '1.0.0', title: '打包对局' }));
    const hostSeat = await waitMessage(host, (m) => m.type === 'seatGranted');
    guest.send(JSON.stringify({ type: 'sessionJoin', sessionId: hostSeat.sessionId, code: hostSeat.code }));
    const guestSeat = await waitMessage(guest, (m) => m.type === 'seatGranted');
    await waitMessage(host, (m) => m.type === 'sessionState' && m.session.members.length === 2);

    const hostChannel = await openChannel(host);
    const guestChannel = await openChannel(guest);
    assert.ok(hostChannel.gameUrl.includes(`/s/${hostSeat.sessionId}/#handoff=`));

    const hostData = await openGameData(service.gamePort, hostChannel.handoffCode);
    const guestData = await openGameData(service.gamePort, guestChannel.handoffCode);

    const hostPrivate = waitFrame(hostData.ws, (p) => p.type === 'private', 10000, 'host-private');
    const guestInitial = waitFrame(guestData.ws, (p) => p.type === 'public', 10000, 'guest-initial');
    host.send(JSON.stringify({ type: 'startGame' }));
    await waitMessage(host, (m) => m.type === 'sessionState' && m.session.gameProcess === 'running');
    const { payload: privateView } = await hostPrivate;
    await guestInitial;
    assert.equal(privateView.view.you, hostSeat.memberId);
    const card = privateView.view.hand[0];
    assert.ok(card);

    const page = await fetch(`http://127.0.0.1:${service.gamePort}/s/${hostSeat.sessionId}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /参考对决/);
    const style = await fetch(`http://127.0.0.1:${service.gamePort}/s/${hostSeat.sessionId}/style.css`);
    assert.equal(style.status, 200);
    assert.match(style.headers.get('content-type') ?? '', /text\/css/);

    const nextTurn = waitFrame(guestData.ws, (p) => p.type === 'public' && p.view.turnNumber === 2, 10000, 'guest-next-turn');
    const payload = Buffer.from(JSON.stringify({ action: { type: 'play', cardId: card.id } }));
    hostData.ws.send(encodeFrame({
      v: 1, channelId: hostData.channelId, to: 'all', seq: 1, mode: 'reliable', payloadBytes: payload.byteLength,
    }, payload));
    const { payload: next } = await nextTurn;
    assert.equal(next.view.currentMemberId, guestSeat.memberId);
  } finally {
    host.close();
    guest.close();
    await service.close();
  }
});
