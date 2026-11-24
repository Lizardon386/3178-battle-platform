import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthorityRuntime, decodeIpcFrames, encodeIpcFrame } from '../dist/index.js';

const makeHooks = (state = { count: 0 }) => {
  const calls = [];
  return {
    calls,
    state,
    hooks: {
      start(message, restored) { calls.push(['start', message, restored]); },
      deliver(message, context) {
        state.count += 1;
        calls.push(['deliver', message]);
        context.deliver([{ to: String(message.fromMemberId), payload: message.payload }]);
      },
      sync(message) { calls.push(['sync', message]); },
      closeSession(message) { calls.push(['close', message]); },
      snapshot() { return state; },
      validateSnapshot(value) { return typeof value === 'object' && value !== null; },
    },
  };
};

test('IPC 帧：粘包/半包切分', () => {
  const a = encodeIpcFrame({ type: 'a' });
  const b = encodeIpcFrame({ type: 'b' });
  let result = decodeIpcFrames(Buffer.concat([a, b]));
  assert.deepEqual(result.messages, [{ type: 'a' }, { type: 'b' }]);
  assert.equal(result.rest.byteLength, 0);
  result = decodeIpcFrames(Buffer.concat([a, b.subarray(0, 3)]));
  assert.deepEqual(result.messages, [{ type: 'a' }]);
  assert.equal(result.rest.byteLength, 3);
});

test('运行时：start、deliver 的逐成员 viewSeq、checkpoint 与恢复', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bp-authority-'));
  const sent = [];
  const fake = makeHooks();
  const runtime = new AuthorityRuntime({
    hooks: fake.hooks,
    transport: { send: (m) => sent.push(m) },
    stateDir: dir,
    sessionId: 'sess-1',
    epoch: 1,
    roundId: 'round-1',
    seed: 7,
  });
  await runtime.start();
  assert.equal(fake.calls[0][0], 'start');
  assert.equal(fake.calls[0][2], undefined);

  await runtime.handle({ type: 'deliver', fromMemberId: 'm1', payload: { op: 'a' }, authorityEpoch: 1 });
  await runtime.handle({ type: 'deliver', fromMemberId: 'm1', payload: { op: 'b' }, authorityEpoch: 1 });
  const deliveries = sent.filter((m) => m.type === 'deliver');
  assert.equal(deliveries.length, 2);
  assert.equal(deliveries[0].gameSequence, 1);

  runtime.deliver([{ to: 'm1', payload: { private: true } }, { to: 'm2', payload: { private: true } }]);
  const direct = sent.filter((m) => m.type === 'deliver').at(-1);
  assert.deepEqual(direct.items.map((item) => [item.to, item.viewSeq]), [['m1', 3], ['m2', 1]]);

  const file = await runtime.checkpoint();
  assert.equal(file.stateHash.length, 64);
  assert.equal(file.gameSequence, 3);

  const restoredHooks = makeHooks({ count: 99 });
  const restoredRuntime = new AuthorityRuntime({
    hooks: restoredHooks.hooks,
    transport: { send: () => {} },
    stateDir: dir,
    sessionId: 'sess-1',
    epoch: 2,
    roundId: 'round-1',
  });
  await restoredRuntime.start();
  assert.deepEqual(restoredHooks.calls[0][2], { count: 2 });
});

test('运行时：closeSession 先 checkpoint 再 closeAck', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bp-authority-'));
  const sent = [];
  const fake = makeHooks();
  const runtime = new AuthorityRuntime({
    hooks: fake.hooks,
    transport: { send: (m) => sent.push(m) },
    stateDir: dir,
    sessionId: 'sess-1',
    epoch: 3,
    roundId: 'round-2',
  });
  await runtime.start();
  await runtime.handle({ type: 'closeSession', reason: 'host closed' });
  const checkpointIndex = sent.findIndex((m) => m.type === 'authorityCheckpoint');
  const ackIndex = sent.findIndex((m) => m.type === 'closeAck');
  assert.ok(checkpointIndex >= 0);
  assert.ok(ackIndex > checkpointIndex);
});
