import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { startService } from '../dist/compose.js';
import { encodeFrame, decodeFrame } from '@bp/session-ws';

const waitOpen = (ws) => new Promise((resolvePromise, reject) => {
  ws.once('open', resolvePromise);
  ws.once('error', reject);
});

const waitMessage = (ws, predicate, timeoutMs = 5000) => new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => reject(new Error('等待消息超时')), timeoutMs);
  const onMessage = (raw, isBinary) => {
    const value = isBinary ? { binary: raw } : JSON.parse(raw.toString());
    if (!predicate(value)) return;
    clearTimeout(timer);
    ws.off('message', onMessage);
    resolvePromise(value);
  };
  ws.on('message', onMessage);
});

const control = async (port) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/control`);
  await waitOpen(ws);
  ws.send(JSON.stringify({ type: 'hello' }));
  await waitMessage(ws, (m) => m.type === 'welcome');
  return ws;
};

test('真实 WS：建房、加入、会话状态与二进制转发', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bp-service-'));
  const service = await startService({ dataDir, port: 0 });
  const host = await control(service.port);
  const guest = await control(service.port);
  try {
    host.send(JSON.stringify({ type: 'sessionCreate', gameId: 'reference-duel', gameVersion: '1.0.0', title: '测试' }));
    const hostSeat = await waitMessage(host, (m) => m.type === 'seatGranted');
    assert.equal(hostSeat.memberId.startsWith('member-'), true);
    assert.equal(hostSeat.code.length, 6);

    guest.send(JSON.stringify({ type: 'sessionJoin', sessionId: hostSeat.sessionId, code: hostSeat.code, displayName: '客人' }));
    const guestSeat = await waitMessage(guest, (m) => m.type === 'seatGranted');
    assert.notEqual(guestSeat.memberId, hostSeat.memberId);

    const state = await waitMessage(host, (m) => m.type === 'sessionState' && m.session.members.length === 2);
    assert.equal(state.session.members.length, 2);
    assert.equal(state.session.ownerMemberId, hostSeat.memberId);

    host.send(JSON.stringify({ type: 'channelOpen' }));
    const hostChannel = await waitMessage(host, (m) => m.type === 'channelGranted');
    guest.send(JSON.stringify({ type: 'channelOpen' }));
    const guestChannel = await waitMessage(guest, (m) => m.type === 'channelGranted');

    const hostData = new WebSocket(`ws://127.0.0.1:${service.port}/ws/data`);
    const guestData = new WebSocket(`ws://127.0.0.1:${service.port}/ws/data`);
    await Promise.all([waitOpen(hostData), waitOpen(guestData)]);
    hostData.send(JSON.stringify({ kind: 'data', channelToken: hostChannel.channelToken }));
    guestData.send(JSON.stringify({ kind: 'data', channelToken: guestChannel.channelToken }));
    await Promise.all([
      waitMessage(hostData, (m) => m.type === 'dataReady'),
      waitMessage(guestData, (m) => m.type === 'dataReady'),
    ]);

    const payload = Buffer.from('hello-guest');
    hostData.send(encodeFrame({
      v: 1, channelId: hostChannel.channelId, to: guestSeat.memberId, seq: 1, mode: 'reliable', payloadBytes: payload.byteLength,
    }, payload));
    const received = await waitMessage(guestData, (m) => m.binary !== undefined);
    const frame = decodeFrame(received.binary);
    assert.equal(frame.header.from, hostSeat.memberId);
    assert.equal(frame.payload.toString(), 'hello-guest');

    guest.send(JSON.stringify({ type: 'sessionLeave' }));
    await waitMessage(host, (m) => m.type === 'sessionState' && m.session.members.length === 1);
  } finally {
    host.close();
    guest.close();
    await service.close();
  }
});
