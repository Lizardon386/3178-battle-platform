import {
  close,
  createSession,
  disconnect,
  err,
  expireGrace,
  findMember,
  findTicket,
  join,
  kick,
  leave,
  ok,
  resume,
  transferOwner,
  type Result,
  type SessionRecord,
} from '@bp/session-core';
import type { Clock, IdGenerator, Logger, SecretStore, SessionRepository } from './ports.js';

export interface CreateInput {
  gameId: string;
  gameVersion: string;
  title?: string;
  inviteSecretHash?: string;
  metadata?: Record<string, unknown>;
}

export interface Created {
  session: SessionRecord;
  memberId: string;
  resumeToken: string;
  generation: number;
}

export interface Joined {
  session: SessionRecord;
  memberId: string;
  resumeToken: string;
  generation: number;
}

export interface ResumeInput {
  sessionId: string;
  presentedToken: string;
}

export interface JoinInput {
  sessionId: string;
  code: string;
  inviteSecret?: string;
  displayName?: string;
}

const KEEP_PREVIOUS_MS = 30_000;
const GRACE_MS = 30 * 60 * 1000;

export class SessionApplication {
  constructor(
    private readonly repository: SessionRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly secrets: SecretStore,
    private readonly logger: Logger,
    private readonly supervisor?: { start(launch: { sessionId: string; epoch: number; runtime: string; entry: string }): Promise<void>; stop(sessionId: string, reason: string): Promise<void> },
  ) {}

  async create(input: CreateInput): Promise<Result<Created>> {
    const now = this.clock.now();
    const sessionId = this.ids.next('sess');
    const code = this.ids.next('code').toUpperCase().slice(0, 6);
    const memberId = this.ids.next('member');
    const ticket = this.secrets.issue();
    const session = createSession({
      sessionId,
      code,
      gameId: input.gameId,
      gameVersion: input.gameVersion,
      ownerMemberId: memberId,
      ownerTicketHash: ticket.hash,
      now,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    });
    if (input.inviteSecretHash) {
      session.metadata = { ...(session.metadata ?? {}), inviteHash: input.inviteSecretHash };
    }
    await this.repository.save(session);
    const created: Created = { session, memberId, resumeToken: ticket.secret, generation: 1 };
    this.logger.info('session created', { sessionId, memberId });
    return ok(created);
  }

  async join(input: JoinInput): Promise<Result<Joined>> {
    const session = await this.repository.load(input.sessionId);
    if (!session) return err('NOROOM', '会话不存在');
    if (session.code !== input.code) return err('NOROOM', '房号不符');
    const inviteHash = session.metadata?.inviteHash;
    if (typeof inviteHash === 'string') {
      if (!input.inviteSecret || this.secrets.hash(input.inviteSecret) !== inviteHash) {
        return err('FORBIDDEN', '邀请凭证无效');
      }
    }
    const memberId = this.ids.next('member');
    const ticket = this.secrets.issue();
    const joined = join(session, {
      memberId,
      ticketHash: ticket.hash,
      now: this.clock.now(),
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    });
    if (!joined.ok) return joined;
    await this.repository.save(joined.value.session);
    this.logger.info('session joined', { sessionId: session.sessionId, memberId });
    return ok({ session: joined.value.session, memberId, resumeToken: ticket.secret, generation: 1 });
  }

  async resumeMember(input: ResumeInput): Promise<Result<Resumed>> {
    const session = await this.repository.load(input.sessionId);
    if (!session) return err('NOROOM', '会话不存在');
    const hash = this.secrets.hash(input.presentedToken);
    const ticket = findTicket(session, hash, this.clock.now());
    if (!ticket) return err('SEATLOST', '票据无效或已过期');
    const next = this.secrets.issue();
    const resumed = resume(session, {
      memberId: ticket.memberId,
      presentedHash: hash,
      nextHash: next.hash,
      now: this.clock.now(),
      keepPreviousMs: KEEP_PREVIOUS_MS,
    });
    if (!resumed.ok) return resumed;
    await this.repository.save(resumed.value);
    const member = findMember(resumed.value, ticket.memberId);
    return ok({
      session: resumed.value,
      memberId: ticket.memberId,
      resumeToken: next.secret,
      generation: member?.connectionGeneration ?? ticket.generation + 1,
    });
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    return this.repository.load(sessionId);
  }

  async authenticate(sessionId: string, memberId: string, token: string): Promise<Result<SessionRecord>> {
    const session = await this.repository.load(sessionId);
    if (!session) return err('NOROOM', '会话不存在');
    const member = findMember(session, memberId);
    if (!member) return err('NOSEAT', '成员不存在');
    const ticket = findTicket(session, this.secrets.hash(token), this.clock.now());
    if (!ticket || ticket.memberId !== memberId) return err('SEATLOST', '票据无效或已过期');
    return ok(session);
  }

  async disconnectMember(sessionId: string, memberId: string): Promise<Result<SessionRecord>> {
    const session = await this.repository.load(sessionId);
    if (!session) return err('NOROOM', '会话不存在');
    const result = disconnect(session, memberId, this.clock.now(), GRACE_MS);
    if (!result.ok) return result;
    await this.repository.save(result.value);
    return result;
  }

  async expire(sessionId: string): Promise<Result<{ session: SessionRecord; expired: string[] }>> {
    const session = await this.repository.load(sessionId);
    if (!session) return err('NOROOM', '会话不存在');
    const result = expireGrace(session, this.clock.now());
    if (!result.ok) return result;
    if (result.value.expired.length > 0) {
      let next = result.value.session;
      if (next.members.every((member) => member.memberId !== next.ownerMemberId)) {
        const successor = next.members.find((member) => member.presence === 'online');
        if (successor) {
          const moved = transferOwner(next, next.ownerMemberId, successor.memberId);
          if (moved.ok) next = moved.value;
        } else {
          const closed = close(next, next.ownerMemberId, this.clock.now());
          if (closed.ok) next = closed.value;
        }
      }
      await this.repository.save(next);
      return ok({ session: next, expired: result.value.expired });
    }
    return ok(result.value);
  }

  async leaveSession(sessionId: string, memberId: string): Promise<Result<SessionRecord>> {
    return this.mutate(sessionId, (session) => leave(session, memberId, this.clock.now()));
  }

  async kickMember(sessionId: string, actorId: string, targetId: string): Promise<Result<SessionRecord>> {
    return this.mutate(sessionId, (session) => kick(session, actorId, targetId, this.clock.now()));
  }

  async transfer(sessionId: string, actorId: string, targetId: string): Promise<Result<SessionRecord>> {
    return this.mutate(sessionId, (session) => transferOwner(session, actorId, targetId));
  }

  async closeSession(sessionId: string, actorId: string): Promise<Result<SessionRecord>> {
    return this.mutate(sessionId, (session) => close(session, actorId, this.clock.now()));
  }

  private async mutate(
    sessionId: string,
    change: (session: SessionRecord) => Result<SessionRecord>,
  ): Promise<Result<SessionRecord>> {
    const session = await this.repository.load(sessionId);
    if (!session) return err('NOROOM', '会话不存在');
    const result = change(session);
    if (!result.ok) return result;
    await this.repository.save(result.value);
    return result;
  }
}

export interface Resumed extends Joined {}
