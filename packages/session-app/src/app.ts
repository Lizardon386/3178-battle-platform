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
import type { AuthoritySupervisor, Clock, IdGenerator, Logger, SecretStore, SessionRepository } from './ports.js';

export interface CreateInput {
  gameId: string;
  gameVersion: string;
  title?: string;
  /** 明文邀请 secret：由平台哈希后落盘，不进日志。 */
  inviteSecret?: string;
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
    private readonly supervisor?: AuthoritySupervisor,
  ) {}

  async create(input: CreateInput): Promise<Result<Created>> {
    const now = this.clock.now();
    const sessionId = this.ids.next('sess');
    const code = this.ids.code();
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
    const inviteHash = input.inviteSecretHash ?? (input.inviteSecret === undefined ? undefined : this.secrets.hash(input.inviteSecret));
    if (inviteHash) {
      session.metadata = { ...(session.metadata ?? {}), inviteHash };
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

  async startGame(
    sessionId: string,
    actorId: string,
    options: { entry: string; runtime?: string; stateRoot: string },
  ): Promise<Result<SessionRecord>> {
    const session = await this.repository.load(sessionId);
    if (!session) return err('NOROOM', '会话不存在');
    if (session.ownerMemberId !== actorId) return err('NOTHOST', '只有房主可以开始游戏');
    if (session.state !== 'open') return err('PHASE', '会话不可开始');
    if (session.gameProcess !== 'stopped') return err('PHASE', '游戏已经开始');
    if (session.members.length < 2) return err('NOTREADY', '至少需要两名成员');
    if (session.members.some((member) => member.presence !== 'online')) return err('NOTREADY', '有成员不在线');
    if (!this.supervisor) return err('GAMEFAILED', '没有可用的权威启动器');

    const epoch = session.authorityEpoch + 1;
    const roundId = session.currentRoundId ?? `round-${epoch}`;
    const starting = structuredClone(session);
    starting.authorityEpoch = epoch;
    starting.currentRoundId = roundId;
    starting.gameProcess = 'starting';
    starting.revision += 1;
    await this.repository.save(starting);
    try {
      await this.supervisor.start({
        sessionId,
        epoch,
        roundId,
        runtime: options.runtime ?? 'node24',
        entry: options.entry,
        stateDir: `${options.stateRoot}/${sessionId}/${roundId}`,
        members: starting.members.map((member) => ({
          memberId: member.memberId,
          ...(member.displayName === undefined ? {} : { displayName: member.displayName }),
        })),
      });
    } catch (error) {
      const failed = structuredClone(starting);
      failed.gameProcess = 'failed';
      failed.revision += 1;
      await this.repository.save(failed);
      this.logger.error('authority start failed', { sessionId, epoch, error: String(error) });
      return err('GAMEFAILED', '游戏进程启动失败');
    }
    // 启动期间 authorityReady 可能已经把状态推进到 running；返回最新快照，避免旧 revision 覆盖。
    return ok((await this.repository.load(sessionId)) ?? starting);
  }

  async recoverGame(
    sessionId: string,
    actorId: string,
    options: { entry: string; runtime?: string; stateRoot: string },
  ): Promise<Result<SessionRecord>> {
    const session = await this.repository.load(sessionId);
    if (!session) return err('NOROOM', '会话不存在');
    if (session.ownerMemberId !== actorId) return err('NOTHOST', '只有房主可以恢复游戏');
    if (session.gameProcess !== 'failed') return err('PHASE', '当前不需要恢复');
    return this.relaunch(session, options);
  }

  /** 房主在同一 Authority 进程里开下一局；roundId 递增，客户端由新视图驱动。 */
  async rematch(sessionId: string, actorId: string): Promise<Result<SessionRecord>> {
    const session = await this.repository.load(sessionId);
    if (!session) return err('NOROOM', '会话不存在');
    if (session.ownerMemberId !== actorId) return err('NOTHOST', '只有房主可以再来一局');
    if (session.state !== 'open') return err('PHASE', '会话不可继续');
    if (session.gameProcess !== 'running') return err('PHASE', '游戏不在运行中');
    if (!session.currentRoundId) return err('PHASE', '没有当前回合');
    if (!this.supervisor) return err('GAMEFAILED', '没有可用的权威启动器');
    const match = /^round-(\d+)$/.exec(session.currentRoundId);
    const roundId = `round-${match ? Number(match[1]) + 1 : Date.now()}`;
    const next = structuredClone(session);
    next.currentRoundId = roundId;
    next.revision += 1;
    await this.repository.save(next);
    this.supervisor.send(sessionId, {
      type: 'startRound',
      authorityEpoch: session.authorityEpoch,
      roundId,
      members: next.members.map((member) => ({ memberId: member.memberId })),
    });
    return ok(next);
  }

  /** 平台自动重启：不要求房主确认，只允许一次；失败后仍由房主手动 recoverGame。 */
  async recoverAuthority(
    sessionId: string,
    options: { entry: string; runtime?: string; stateRoot: string },
  ): Promise<Result<SessionRecord>> {
    const session = await this.repository.load(sessionId);
    if (!session) return err('NOROOM', '会话不存在');
    if (session.state !== 'open') return err('PHASE', '会话不可恢复');
    if (session.gameProcess !== 'running' && session.gameProcess !== 'starting') {
      return err('PHASE', '游戏不在运行中');
    }
    return this.relaunch(session, options);
  }

  private async relaunch(
    session: SessionRecord,
    options: { entry: string; runtime?: string; stateRoot: string },
  ): Promise<Result<SessionRecord>> {
    if (!session.currentRoundId) return err('PHASE', '没有可恢复的回合');
    if (!this.supervisor) return err('GAMEFAILED', '没有可用的权威启动器');
    const sessionId = session.sessionId;
    const epoch = session.authorityEpoch + 1;
    const roundId = session.currentRoundId;
    const starting = structuredClone(session);
    starting.authorityEpoch = epoch;
    starting.gameProcess = 'starting';
    starting.revision += 1;
    await this.repository.save(starting);
    try {
      await this.supervisor.start({
        sessionId,
        epoch,
        roundId,
        runtime: options.runtime ?? 'node24',
        entry: options.entry,
        stateDir: `${options.stateRoot}/${sessionId}/${roundId}`,
        members: starting.members.map((member) => ({
          memberId: member.memberId,
          ...(member.displayName === undefined ? {} : { displayName: member.displayName }),
        })),
      });
    } catch (error) {
      const failed = structuredClone(starting);
      failed.gameProcess = 'failed';
      failed.revision += 1;
      await this.repository.save(failed);
      this.logger.error('authority recover failed', { sessionId, epoch, error: String(error) });
      return err('GAMEFAILED', '游戏进程恢复失败');
    }
    return ok((await this.repository.load(sessionId)) ?? starting);
  }

  async markAuthorityReady(sessionId: string, epoch: number): Promise<Result<SessionRecord>> {
    const session = await this.repository.load(sessionId);
    if (!session) return err('NOROOM', '会话不存在');
    if (session.authorityEpoch !== epoch) return err('STALE_EPOCH', '权威代际已过期');
    if (session.gameProcess !== 'starting') return err('PHASE', '当前不在启动中');
    const next = structuredClone(session);
    next.gameProcess = 'running';
    next.revision += 1;
    await this.repository.save(next);
    return ok(next);
  }

  async markAuthorityFailed(sessionId: string, epoch: number, text: string): Promise<Result<SessionRecord>> {
    const session = await this.repository.load(sessionId);
    if (!session) return err('NOROOM', '会话不存在');
    if (session.authorityEpoch !== epoch) return err('STALE_EPOCH', '权威代际已过期');
    const next = structuredClone(session);
    next.gameProcess = 'failed';
    next.revision += 1;
    await this.repository.save(next);
    this.logger.error('authority failed', { sessionId, epoch, text });
    return ok(next);
  }

  /** 数据通道建好后请求权威补一份该成员视角；Authority 不在运行时静默跳过。 */
  async syncMember(sessionId: string, memberId: string): Promise<void> {
    const session = await this.repository.load(sessionId);
    if (!session || !this.supervisor) return;
    if (session.gameProcess !== 'running' && session.gameProcess !== 'starting') return;
    this.supervisor.send(sessionId, {
      type: 'sync',
      authorityEpoch: session.authorityEpoch,
      memberId,
    });
  }

  async routeGame(sessionId: string, memberId: string, payload: unknown): Promise<Result<void>> {
    const session = await this.repository.load(sessionId);
    if (!session) return err('NOROOM', '会话不存在');
    if (session.gameProcess !== 'running') return err('PHASE', '游戏尚未开始');
    if (!this.supervisor) return err('GAMEFAILED', '没有可用的权威');
    this.supervisor.send(sessionId, {
      type: 'deliver',
      authorityEpoch: session.authorityEpoch,
      fromMemberId: memberId,
      payload,
    });
    return ok(undefined);
  }

  async stopAuthority(sessionId: string, reason: string): Promise<void> {
    if (this.supervisor) await this.supervisor.stop(sessionId, reason);
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
