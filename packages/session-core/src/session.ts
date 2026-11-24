import {
  DEFAULT_LIMITS,
  err,
  ok,
  type MemberRecord,
  type Presence,
  type Result,
  type SessionLimits,
  type SessionRecord,
  type TicketRecord,
} from './types.js';

export interface CreateSessionInput {
  sessionId: string;
  code: string;
  gameId: string;
  gameVersion: string;
  ownerMemberId: string;
  ownerTicketHash: string;
  now: number;
  limits?: Partial<SessionLimits>;
  metadata?: Record<string, unknown>;
}

export interface JoinInput {
  memberId: string;
  ticketHash: string;
  displayName?: string;
  now: number;
}

const clone = (session: SessionRecord): SessionRecord => structuredClone(session);

const bump = (session: SessionRecord): void => {
  session.revision += 1;
};

export function createSession(input: CreateSessionInput): SessionRecord {
  return {
    schemaVersion: 1,
    sessionId: input.sessionId,
    code: input.code,
    gameId: input.gameId,
    gameVersion: input.gameVersion,
    ownerMemberId: input.ownerMemberId,
    members: [{ memberId: input.ownerMemberId, presence: 'online', connectionGeneration: 1 }],
    tickets: [{ hash: input.ownerTicketHash, memberId: input.ownerMemberId, generation: 1 }],
    revision: 1,
    state: 'open',
    createdAt: input.now,
    limits: { ...DEFAULT_LIMITS, ...input.limits },
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

export function findMember(session: SessionRecord, memberId: string): MemberRecord | undefined {
  return session.members.find((member) => member.memberId === memberId);
}

export function findTicket(session: SessionRecord, hash: string, now: number): TicketRecord | undefined {
  return session.tickets.find((ticket) =>
    ticket.revokedAt === undefined
    && (ticket.hash === hash || (ticket.previousHash === hash && (ticket.previousUntil ?? 0) >= now)));
}

export function isOwner(session: SessionRecord, memberId: string): boolean {
  return session.ownerMemberId === memberId;
}

export function join(session: SessionRecord, input: JoinInput): Result<{ session: SessionRecord; member: MemberRecord }> {
  if (session.state !== 'open') return err('NOROOM', '会话不可加入');
  if (session.members.length >= session.limits.maxMembers) return err('FULL', '成员已满');
  if (session.members.some((member) => member.memberId === input.memberId)) {
    return err('PHASE', '成员已存在');
  }
  const next = clone(session);
  const member: MemberRecord = {
    memberId: input.memberId,
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    presence: 'online',
    connectionGeneration: 1,
  };
  next.members.push(member);
  next.tickets.push({ hash: input.ticketHash, memberId: input.memberId, generation: 1 });
  bump(next);
  return ok({ session: next, member });
}

export function disconnect(session: SessionRecord, memberId: string, now: number, graceMs: number): Result<SessionRecord> {
  const member = findMember(session, memberId);
  if (!member) return err('NOSEAT', '成员不存在');
  const next = clone(session);
  const target = findMember(next, memberId)!;
  target.presence = 'grace';
  target.graceUntil = now + graceMs;
  bump(next);
  return ok(next);
}

export function resume(
  session: SessionRecord,
  input: { memberId: string; presentedHash: string; nextHash: string; now: number; keepPreviousMs: number },
): Result<SessionRecord> {
  const ticket = findTicket(session, input.presentedHash, input.now);
  if (!ticket || ticket.memberId !== input.memberId) return err('SEATLOST', '票据无效或已过期');
  const member = findMember(session, input.memberId);
  if (!member) return err('NOSEAT', '成员不存在');
  const next = clone(session);
  const target = findMember(next, input.memberId)!;
  target.presence = 'online';
  target.graceUntil = undefined;
  target.connectionGeneration += 1;
  const rotated = rotateTicket(next, input.memberId, input.nextHash, input.now, input.keepPreviousMs);
  if (!rotated.ok) return rotated;
  return ok(rotated.value);
}

/** 轮换票据：旧票保留一个短暂窗口，避免“新票已生成但响应丢失”把客户端锁死。 */
export function rotateTicket(
  session: SessionRecord,
  memberId: string,
  nextHash: string,
  now: number,
  keepPreviousMs: number,
): Result<SessionRecord> {
  const live = session.tickets.filter((ticket) => ticket.memberId === memberId && ticket.revokedAt === undefined);
  const current = live[live.length - 1];
  if (!current) return err('SEATLOST', '没有可轮换的票据');
  const next = clone(session);
  const currentInNext = next.tickets.find((ticket) => ticket.hash === current.hash)!;
  currentInNext.previousHash = current.hash;
  currentInNext.previousUntil = now + keepPreviousMs;
  next.tickets.push({ hash: nextHash, memberId, generation: current.generation + 1 });
  bump(next);
  return ok(next);
}

export function revokeMemberTickets(session: SessionRecord, memberId: string, now: number): SessionRecord {
  const next = clone(session);
  for (const ticket of next.tickets) {
    if (ticket.memberId === memberId && ticket.revokedAt === undefined) ticket.revokedAt = now;
  }
  bump(next);
  return next;
}

export function leave(session: SessionRecord, memberId: string, now: number): Result<SessionRecord> {
  if (isOwner(session, memberId)) return err('HOSTONLY', '房主离开前先移交或关闭会话');
  const member = findMember(session, memberId);
  if (!member) return err('NOSEAT', '成员不存在');
  let next = clone(session);
  next.members = next.members.filter((item) => item.memberId !== memberId);
  next = revokeMemberTickets(next, memberId, now);
  bump(next);
  return ok(next);
}

export function kick(session: SessionRecord, actorId: string, targetId: string, now: number): Result<SessionRecord> {
  if (!isOwner(session, actorId)) return err('NOTHOST', '只有房主可以请出成员');
  if (targetId === session.ownerMemberId) return err('HOSTONLY', '不能请出房主');
  const member = findMember(session, targetId);
  if (!member) return err('NOSEAT', '成员不存在');
  let next = clone(session);
  next.members = next.members.filter((item) => item.memberId !== targetId);
  next = revokeMemberTickets(next, targetId, now);
  bump(next);
  return ok(next);
}

export function close(session: SessionRecord, actorId: string, now: number): Result<SessionRecord> {
  if (!isOwner(session, actorId)) return err('NOTHOST', '只有房主可以关闭会话');
  const next = clone(session);
  next.state = 'closing';
  for (const ticket of next.tickets) if (ticket.revokedAt === undefined) ticket.revokedAt = now;
  next.state = 'closed';
  bump(next);
  return ok(next);
}

/** 宽限到期：移除成员并撤销其票据。房主到期由调用方决定移交或关闭。 */
export function expireGrace(session: SessionRecord, now: number): Result<{ session: SessionRecord; expired: string[] }> {
  const expired = session.members
    .filter((member) => member.presence === 'grace' && (member.graceUntil ?? Number.POSITIVE_INFINITY) <= now)
    .map((member) => member.memberId);
  if (expired.length === 0) return ok({ session, expired });
  let next = clone(session);
  for (const memberId of expired) {
    next.members = next.members.filter((member) => member.memberId !== memberId);
    next = revokeMemberTickets(next, memberId, now);
  }
  bump(next);
  return ok({ session: next, expired });
}

export function transferOwner(session: SessionRecord, actorId: string, targetId: string): Result<SessionRecord> {
  if (!isOwner(session, actorId)) return err('NOTHOST', '只有房主可以移交');
  const target = findMember(session, targetId);
  if (!target) return err('NOSEAT', '接任者不存在');
  const next = clone(session);
  next.ownerMemberId = targetId;
  bump(next);
  return ok(next);
}

export function setPresence(session: SessionRecord, memberId: string, presence: Presence, now: number): Result<SessionRecord> {
  const member = findMember(session, memberId);
  if (!member) return err('NOSEAT', '成员不存在');
  const next = clone(session);
  const target = findMember(next, memberId)!;
  target.presence = presence;
  target.graceUntil = presence === 'grace' ? now : undefined;
  bump(next);
  return ok(next);
}
