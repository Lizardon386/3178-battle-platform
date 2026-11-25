import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReferenceAuthority } from '../dist/authority/index.js';

test('Authority：启动后发送公共与私密视图，动作后按成员投递', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'bp-refduel-'));
  const sent = [];
  const runtime = createReferenceAuthority({
    stateDir,
    sessionId: 'sess-1',
    epoch: 1,
    roundId: 'round-1',
    members: [{ memberId: 'm1' }, { memberId: 'm2' }],
    transport: { send: (message) => sent.push(message) },
    seed: 7,
  });
  await runtime.start();
  assert.ok(sent.some((m) => m.type === 'authorityReady'));
  const first = sent.find((m) => m.type === 'deliver');
  assert.ok(first);
  assert.equal(first.items.some((item) => item.to === 'all'), true);
  assert.equal(first.items.some((item) => item.to === 'm1' && item.payload.type === 'private'), true);
  assert.equal(first.items.some((item) => item.to === 'm2' && item.payload.type === 'private'), true);

  const before = first.items.find((item) => item.to === 'm1').payload.view;
  const card = before.hand[0];
  await runtime.handle({ type: 'deliver', fromMemberId: 'm1', payload: { action: { type: 'play', cardId: card.id } }, authorityEpoch: 1 });
  const after = sent.filter((m) => m.type === 'deliver').at(-1);
  const publicView = after.items.find((item) => item.to === 'all').payload.view;
  assert.equal(publicView.turnNumber, 2);
  assert.equal(publicView.currentMemberId, 'm2');

  await runtime.handle({ type: 'sync', memberId: 'm2', authorityEpoch: 1 });
  const sync = sent.filter((m) => m.type === 'deliver').at(-1);
  assert.equal(sync.items[0].to, 'm2');
  assert.equal(sync.items[0].payload.type, 'public');
  assert.equal(sync.items[1].payload.type, 'private');

  await runtime.handle({ type: 'startRound', roundId: 'round-2', authorityEpoch: 1 });
  const restart = sent.filter((m) => m.type === 'deliver').at(-1);
  const resetPublic = restart.items.find((item) => item.to === 'all').payload.view;
  assert.equal(resetPublic.roundId, 'round-2');
  assert.equal(resetPublic.turnNumber, 1);
  assert.equal(resetPublic.finished, false);
  const checkpoint = sent.filter((m) => m.type === 'authorityCheckpoint').at(-1);
  assert.equal(checkpoint.roundId, 'round-2');
});
