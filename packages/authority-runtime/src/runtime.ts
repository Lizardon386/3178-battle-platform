import { readCheckpoint, writeCheckpoint, type CheckpointFile } from './checkpoint.js';
import type { AuthorityContext, AuthorityHooks, DeliveryItem, RuntimeOptions, Transport } from './types.js';

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export class AuthorityRuntime {
  private readonly hooks: AuthorityHooks;
  private readonly transport: Transport;
  private readonly options: RuntimeOptions;
  private readonly random: () => number;
  private gameSequence = 0;
  private readonly viewSeqByMember = new Map<string, number>();
  private closed = false;
  private readonly context: AuthorityContext;

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.hooks = options.hooks;
    this.transport = options.transport;
    this.random = mulberry32(options.seed ?? 1);
    this.context = {
      now: () => Date.now(),
      random: () => this.random(),
      ready: () => this.ready(),
      deliver: (items) => this.deliver(items),
      roundClosed: (payload) => this.roundClosed(payload),
      fail: (code, text, fatal) => this.fail(code, text, fatal ?? false),
      checkpoint: async () => { await this.checkpoint(); },
    };
  }

  async start(): Promise<void> {
    const restored = await readCheckpoint(this.options.stateDir);
    if (restored) {
      if (this.hooks.validateSnapshot && !this.hooks.validateSnapshot(restored.state)) {
        throw new Error('快照校验失败');
      }
      this.gameSequence = restored.gameSequence;
      for (const [memberId, seq] of Object.entries(restored.viewSeqByMember)) this.viewSeqByMember.set(memberId, seq);
    }
    await this.hooks.start({
      type: 'start',
      sessionId: this.options.sessionId,
      epoch: this.options.epoch,
      roundId: this.options.roundId,
      members: this.options.members ?? [],
    }, restored?.state, this.context);
  }

  async handle(message: Record<string, unknown>): Promise<void> {
    if (this.closed) return;
    const type = message.type;
    if (type === 'ping') {
      this.transport.send({ type: 'pong', nonce: message.nonce });
      return;
    }
    if (this.hooksFor(type)) {
      await this.hooksFor(type)!(message, this.context);
      if (type === 'closeSession') {
        await this.checkpoint();
        this.closed = true;
        this.transport.send({
          type: 'closeAck', authorityEpoch: this.options.epoch, roundId: this.options.roundId,
          checkpointId: `${this.options.sessionId}:${this.options.roundId}:${this.gameSequence}`, status: 'closed',
        });
      }
      return;
    }
    if (type === 'deliver') {
      await this.hooks.deliver(message, this.context);
      return;
    }
    if (type === 'sync') {
      if (this.hooks.sync) await this.hooks.sync(message, this.context);
      return;
    }
    this.transport.send({ type: 'authorityError', authorityEpoch: this.options.epoch, code: 'BADMSG', text: `未知消息 ${String(type)}`, fatal: false });
  }

  private hooksFor(type: unknown) {
    switch (type) {
      case 'memberJoin': return this.hooks.memberJoin;
      case 'memberLeave': return this.hooks.memberLeave;
      case 'memberResume': return this.hooks.memberResume;
      case 'memberUpdate': return this.hooks.memberUpdate;
      case 'hostChanged': return this.hooks.hostChanged;
      case 'closeSession': return this.hooks.closeSession;
      default: return undefined;
    }
  }

  ready(): void {
    this.transport.send({
      type: 'authorityReady', authorityEpoch: this.options.epoch, processStatus: 'running',
      roundId: this.options.roundId, commitSeq: this.gameSequence,
    });
  }

  deliver(items: DeliveryItem[]): void {
    if (this.closed) return;
    this.gameSequence += 1;
    const delivered = items.map((item) => {
      const next = (this.viewSeqByMember.get(item.to) ?? 0) + 1;
      this.viewSeqByMember.set(item.to, next);
      return { ...item, viewSeq: next };
    });
    this.transport.send({
      type: 'deliver', authorityEpoch: this.options.epoch, roundId: this.options.roundId,
      gameSequence: this.gameSequence, items: delivered,
    });
  }

  roundClosed(payload: unknown): void {
    this.transport.send({ type: 'roundClosed', authorityEpoch: this.options.epoch, roundId: this.options.roundId, payload });
  }

  fail(code: string, text: string, fatal: boolean): void {
    this.transport.send({ type: 'authorityError', authorityEpoch: this.options.epoch, code, text, fatal });
  }

  async checkpoint(): Promise<CheckpointFile> {
    const state = this.hooks.snapshot ? this.hooks.snapshot() : null;
    const file = await writeCheckpoint(this.options.stateDir, {
      version: 1,
      sessionId: this.options.sessionId,
      roundId: this.options.roundId,
      epoch: this.options.epoch,
      gameSequence: this.gameSequence,
      viewSeqByMember: Object.fromEntries(this.viewSeqByMember),
      state,
    });
    this.transport.send({
      type: 'authorityCheckpoint', authorityEpoch: this.options.epoch, roundId: this.options.roundId,
      checkpointId: file.stateHash, commitSeq: this.gameSequence, viewSeqByMember: file.viewSeqByMember,
    });
    return file;
  }
}
