import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
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

const openRoom = async (service) => {
  const host = await connectControl(service.port);
  const guest = await connectControl(service.port);
  host.send(JSON.stringify({ type: 'sessionCreate', gameId: 'grace-game', gameVersion: '1.0.0' }));
  const hostSeat = await waitMessage(host, (m) => m.type === 'seatGranted');
  guest.send(JSON.stringify({ type: 'sessionJoin', sessionId: hostSeat.sessionId, code: hostSeat.code }));
  const guestSeat = await waitMessage(guest, (m) => m.type === 'seatGranted');
  await waitMessage(host, (m) => m.type === 'sessionState' && m.session.members.length === 2);
  return { host, guest, hostSeat, guestSeat };
};

test('宽限到期：断线成员被移除', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bp-grace-'));
  const service = await startService({ dataDir, port: 0, graceMs: 200, expireIntervalMs: 30 });
  const { host, guest, hostSeat } = await openRoom(service);
  try {
    guest.close();
    const state = await waitMessage(host, (m) => m.type === 'sessionState' && m.session.members.length === 1);
    assert.deepEqual(state.session.members.map((member) => member.memberId), [hostSeat.memberId]);
  } finally {
    host.close();
    guest.close();
    await service.close();
  }
});

test('宽限到期：房主断线移交给在线成员', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bp-grace-'));
  const service = await startService({ dataDir, port: 0, graceMs: 200, expireIntervalMs: 30 });
  const { host, guest, guestSeat } = await openRoom(service);
  try {
    host.close();
    const state = await waitMessage(
      guest,
      (m) => m.type === 'sessionState' && m.session.ownerMemberId === guestSeat.memberId,
    );
    assert.equal(state.session.members.length, 1);
    assert.equal(state.session.members[0].memberId, guestSeat.memberId);
  } finally {
    host.close();
    guest.close();
    await service.close();
  }
});
