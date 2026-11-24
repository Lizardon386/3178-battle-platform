import test from 'node:test';
import assert from 'node:assert/strict';
import {
  close,
  createSession,
  disconnect,
  expireGrace,
  findMember,
  join,
  kick,
  leave,
  resume,
  transferOwner,
} from '../dist/index.js';

const base = () => createSession({
  sessionId: 'sess-1',
  code: 'ABCD',
  gameId: 'reference-duel',
  gameVersion: '1.0.0',
  ownerMemberId: 'm1',
  ownerTicketHash: 'h1',
  now: 1000,
  limits: { maxMembers: 2 },
});

test('建房：房主在线、票据 generation=1、revision=1', () => {
  const session = base();
  assert.equal(session.state, 'open');
  assert.equal(session.ownerMemberId, 'm1');
  assert.equal(findMember(session, 'm1').presence, 'online');
  assert.deepEqual(session.tickets.map((t) => [t.hash, t.generation]), [['h1', 1]]);
  assert.equal(session.revision, 1);
});

test('加入：分配成员与票据，容量满时拒绝', () => {
  const created = base();
  const first = join(created, { memberId: 'm2', ticketHash: 'h2', now: 1100, displayName: '客人' });
  assert.equal(first.ok, true);
  assert.equal(first.value.session.members.length, 2);
  assert.equal(first.value.session.revision, 2);
  const full = join(first.value.session, { memberId: 'm3', ticketHash: 'h3', now: 1200 });
  assert.equal(full.ok, false);
  assert.equal(full.error.code, 'FULL');
});

test('断线与恢复：进入宽限、凭票回原成员并轮换票据', () => {
  let session = base();
  session = join(session, { memberId: 'm2', ticketHash: 'h2', now: 1100 }).value.session;
  const gone = disconnect(session, 'm2', 2000, 30_000);
  assert.equal(gone.ok, true);
  assert.equal(findMember(gone.value, 'm2').presence, 'grace');
  assert.equal(findMember(gone.value, 'm2').graceUntil, 32_000);

  const back = resume(gone.value, { memberId: 'm2', presentedHash: 'h2', nextHash: 'h2b', now: 3000, keepPreviousMs: 30_000 });
  assert.equal(back.ok, true);
  assert.equal(findMember(back.value, 'm2').presence, 'online');
  assert.equal(findMember(back.value, 'm2').connectionGeneration, 2);
  assert.deepEqual(back.value.tickets.map((t) => [t.hash, t.generation]), [['h1', 1], ['h2', 1], ['h2b', 2]]);
  const old = back.value.tickets.find((t) => t.hash === 'h2');
  assert.equal(old.previousUntil, 33_000);
});

test('错误票据被拒绝', () => {
  let session = base();
  session = join(session, { memberId: 'm2', ticketHash: 'h2', now: 1100 }).value.session;
  const bad = resume(session, { memberId: 'm2', presentedHash: 'nope', nextHash: 'x', now: 2000, keepPreviousMs: 1000 });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'SEATLOST');
});

test('宽限到期：移除成员并撤销票据', () => {
  let session = base();
  session = join(session, { memberId: 'm2', ticketHash: 'h2', now: 1100 }).value.session;
  session = disconnect(session, 'm2', 2000, 30_000).value;
  const expired = expireGrace(session, 31_999);
  assert.deepEqual(expired.value.expired, []);
  const later = expireGrace(session, 32_000);
  assert.deepEqual(later.value.expired, ['m2']);
  assert.equal(findMember(later.value.session, 'm2'), undefined);
  assert.ok(later.value.session.tickets.filter((t) => t.memberId === 'm2').every((t) => t.revokedAt !== undefined));
});

test('权限：房主离开被拒、请出他人、移交给在线成员', () => {
  let session = base();
  session = join(session, { memberId: 'm2', ticketHash: 'h2', now: 1100 }).value.session;
  assert.equal(leave(session, 'm1', 1200).error.code, 'HOSTONLY');
  assert.equal(kick(session, 'm2', 'm1', 1200).error.code, 'NOTHOST');
  assert.equal(kick(session, 'm1', 'm1', 1200).error.code, 'HOSTONLY');
  const kicked = kick(session, 'm1', 'm2', 1200);
  assert.equal(kicked.ok, true);
  assert.equal(kicked.value.members.length, 1);

  session = join(kicked.value, { memberId: 'm3', ticketHash: 'h3', now: 1300 }).value.session;
  const moved = transferOwner(session, 'm1', 'm3');
  assert.equal(moved.ok, true);
  assert.equal(moved.value.ownerMemberId, 'm3');
});

test('关闭会话：撤销全部票据，状态 closed', () => {
  const closed = close(base(), 'm1', 5000);
  assert.equal(closed.ok, true);
  assert.equal(closed.value.state, 'closed');
  assert.ok(closed.value.tickets.every((t) => t.revokedAt === 5000));
});
