import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { startService } from '../dist/compose.js';
import { encodeFrame, decodeFrame } from '@bp/session-ws';

const authorityEntry = fileURLToPath(new URL('../../../examples/reference-duel/dist/authority/process.js', import.meta.url));

const waitOpen = (ws) => new Promise((resolvePromise, reject) => {
  ws.once('open', resolvePromise);
  ws.once('error', reject);
});

const waitMessage = (ws, predicate, timeoutMs = 8000) => new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => reject(new Error('等待消息超时')), timeoutMs);
  const onMessage = (raw, isBinary) => {
    const value = isBinary ? { frame: decodeFrame(raw) } : JSON.parse(raw.toString());
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

const openData = async (port, control) => {
  control.send(JSON.stringify({ type: 'channelOpen' }));
  const granted = await waitMessage(control, (m) => m.type === 'channelGranted');
  const data = new WebSocket(`ws://127.0.0.1:${port}/ws/data`);
  await waitOpen(data);
  data.send(JSON.stringify({ kind: 'data', channelToken: granted.channelToken }));
  await waitMessage(data, (m) => m.type === 'dataReady');
  return data;
};

test('真实链路：Session Service 启动 Authority，动作经 IPC 回到客户端', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bp-e2e-'));
  const service = await startService({ dataDir, port: 0, authorityEntry });
  const host = await connectControl(service.port);
  const guest = await connectControl(service.port);
  try {
    host.send(JSON.stringify({ type: 'sessionCreate', gameId: 'reference-duel', gameVersion: '1.0.0', title: '真实链路' }));
    const hostSeat = await waitMessage(host, (m) => m.type === 'seatGranted');
    guest.send(JSON.stringify({ type: 'sessionJoin', sessionId: hostSeat.sessionId, code: hostSeat.code }));
    const guestSeat = await waitMessage(guest, (m) => m.type === 'seatGranted');
    await waitMessage(host, (m) => m.type === 'sessionState' && m.session.members.length === 2);

    const hostData = await openData(service.port, host);
    const guestData = await openData(service.port, guest);

    const hostPrivate = waitMessage(hostData, (m) => m.frame && m.frame.payload.toString().includes('"type":"private"'), 10000);
    host.send(JSON.stringify({ type: 'startGame' }));
    await waitMessage(host, (m) => m.type === 'sessionState' && m.session.gameProcess === 'running', 10000);

    const hostView = await hostPrivate;
    const initial = JSON.parse(hostView.frame.payload.toString());
    assert.equal(initial.view.you, hostSeat.memberId);
    const card = initial.view.hand[0];
    assert.ok(card);

    const payload = Buffer.from(JSON.stringify({ action: { type: 'play', cardId: card.id } }));
    const publicView = waitMessage(guestData, (m) => {
      if (!m.frame) return false;
      const text = m.frame.payload.toString();
      return text.includes('"type":"public"') && text.includes('"turnNumber":2');
    }, 10000);
    hostData.send(encodeFrame({ v: 1, channelId: 'test', to: guestSeat.memberId, seq: 1, mode: 'reliable', payloadBytes: payload.byteLength }, payload));

    const publicFrame = await publicView;
    const view = JSON.parse(publicFrame.frame.payload.toString());
    assert.equal(view.view.currentMemberId, guestSeat.memberId);
  } finally {
    host.close();
    guest.close();
    await service.close();
  }
});
