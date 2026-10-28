import { stableDigest, type Effect, type GameContext, type GameInstance, type GameModule, type Outcome, type ViewerId } from '@3178/game-sdk';

/**
 * 测试夹具：回合制 + 隐私状态。
 * 给"平台是否真的无关玩法"提供一个形状——它猜数字、有当前行动者、每人一个秘密值。
 * 与 simultaneous 夹具的形状完全不同，但两者用的是同一份平台代码。
 */

interface TurnState {
  secret: Record<string, number>;
  score: Record<string, number>;
  current: string | null;
  order: string[];
  deadline: number;
  winner: string | null;
  lines: string[];
}

interface TurnConfig {
  range: number;
  target: number;
  turnMs: number;
}

function normalize(raw: Record<string, unknown> | undefined): TurnConfig {
  const num = (v: unknown, min: number, max: number, dft: number): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return dft;
    return Math.min(max, Math.max(min, Math.trunc(v)));
  };
  return {
    range: num(raw?.range, 4, 99, 30),
    target: num(raw?.target, 2, 40, 6),
    turnMs: num(raw?.turnMs, 5_000, 300_000, 60_000),
  };
}

class TurnInstance implements GameInstance {
  private state: TurnState;

  constructor(private readonly config: TurnConfig, private readonly ctx: GameContext, state?: TurnState) {
    this.state = state ?? {
      secret: {},
      score: {},
      current: null,
      order: [],
      deadline: 0,
      winner: null,
      lines: [],
    };
  }

  begin(): Outcome {
    const players = this.ctx.seats().filter((s) => s.role === 'host' || s.role === 'player' || s.role === 'ai');
    if (players.length < 2) return { reject: '至少两人才能开局', code: 'PHASE' };
    this.state.order = players.map((p) => p.seatId);
    this.state.score = Object.fromEntries(players.map((p) => [p.seatId, 0]));
    this.state.secret = Object.fromEntries(
      players.map((p) => [p.seatId, 1 + Math.floor(this.ctx.random() * this.config.range)]),
    );
    this.state.current = this.state.order[0] ?? null;
    this.state.winner = null;
    this.state.deadline = this.ctx.now() + this.config.turnMs;
    this.push(`各自拿到一个 1~${this.config.range} 的秘密数字，先到 ${this.config.target} 分者胜`);
    return [{ kind: 'broadcast', name: 'roundBegin' }];
  }

  private push(line: string): void {
    this.state.lines.push(line);
    if (this.state.lines.length > 12) this.state.lines.shift();
  }

  private advance(): void {
    if (this.state.order.length === 0) return;
    const index = this.state.current === null ? -1 : this.state.order.indexOf(this.state.current);
    this.state.current = this.state.order[(index + 1) % this.state.order.length] ?? null;
    this.state.deadline = this.ctx.now() + this.config.turnMs;
  }

  private nameOf(seatId: string): string {
    return this.ctx.seat(seatId)?.name ?? seatId;
  }

  private award(seatId: string, points: number): void {
    this.state.score[seatId] = (this.state.score[seatId] ?? 0) + points;
    if ((this.state.score[seatId] ?? 0) >= this.config.target && !this.state.winner) {
      this.state.winner = seatId;
    }
  }

  handle(action: { name: string; payload?: unknown }, by: string): Outcome {
    if (this.state.winner) return { reject: '这局已经结束了', code: 'PHASE' };
    if (this.state.current !== by) return { reject: '还没轮到你', code: 'PHASE' };
    const effects: Effect[] = [];
    const payload = (action.payload ?? {}) as { targetSeatId?: string; value?: number };

    if (action.name === 'guess') {
      const victim = this.state.order.find((id) => id === payload.targetSeatId && id !== by);
      if (!victim) return { reject: '要猜谁？得选个别的玩家', code: 'PHASE' };
      if (typeof payload.value !== 'number') return { reject: '猜的数字不对', code: 'BADMSG' };
      const hit = this.state.secret[victim] === payload.value;
      if (hit) {
        this.award(by, 2);
        this.push(`${this.nameOf(by)} 猜中了 ${this.nameOf(victim)} 的数字，+2`);
        effects.push({ kind: 'toSeat', seatId: victim, name: 'exposed', payload: { value: payload.value } });
      } else {
        this.award(victim, 1);
        this.push(`${this.nameOf(by)} 猜错（${payload.value}），${this.nameOf(victim)} +1`);
      }
      effects.push({ kind: 'broadcast', name: 'guess', payload: { by, victim, value: payload.value, hit } });
    } else if (action.name === 'pass') {
      this.push(`${this.nameOf(by)} 放弃本轮`);
      effects.push({ kind: 'broadcast', name: 'pass', payload: { by } });
    } else if (action.name === 'reveal') {
      const own = this.state.secret[by];
      this.push(`${this.nameOf(by)} 公开了自己的数字 ${own}`);
      effects.push({ kind: 'broadcast', name: 'reveal', payload: { by, value: own } });
    } else {
      return { reject: `回合制夹具没有这个动作：${action.name}`, code: 'BADMSG' };
    }

    if (this.state.winner) {
      effects.push({ kind: 'end', reason: `${this.nameOf(this.state.winner)} 先到了 ${this.config.target} 分` });
      effects.push({ kind: 'broadcast', name: 'gameOver', payload: { winner: this.state.winner } });
      return effects;
    }
    this.advance();
    return effects;
  }

  tick(now: number): Effect[] {
    if (this.state.winner || !this.state.current) return [];
    if (now < this.state.deadline) return [];
    const stalled = this.state.current;
    this.push(`${this.nameOf(stalled)} 超时，自动跳过`);
    this.advance();
    return [{ kind: 'broadcast', name: 'timeout', payload: { seatId: stalled } }];
  }

  onSeatLeave(seat: { seatId: string; name: string }): Effect[] {
    const index = this.state.order.indexOf(seat.seatId);
    if (index < 0) return [];
    this.state.order.splice(index, 1);
    if (this.state.current === seat.seatId) {
      this.state.current = this.state.order[index % Math.max(1, this.state.order.length)] ?? null;
      this.state.deadline = this.ctx.now() + this.config.turnMs;
    }
    delete this.state.secret[seat.seatId];
    return [{ kind: 'system', text: `${seat.name} 离开，回合顺序已调整` }];
  }

  onTimeout(seat: { seatId: string; name: string }): Effect[] {
    if (this.state.current !== seat.seatId) return [];
    this.advance();
    return [{ kind: 'broadcast', name: 'timeout', payload: { seatId: seat.seatId, reason: 'seat-gc' } }];
  }

  serialize(viewer: ViewerId): unknown {
    const shared = {
      kind: 'fixture-turn',
      target: this.config.target,
      // 计分表只列参战座位：中途进来的观战者不该出现在分数里。
      scores: this.state.order.map((seatId) => ({
        seatId,
        name: this.nameOf(seatId),
        score: this.state.score[seatId] ?? 0,
      })),
      current: this.state.current,
      deadlineInMs: this.state.current ? Math.max(0, this.state.deadline - this.ctx.now()) : null,
      winner: this.state.winner,
      lines: this.state.lines,
    };
    if (viewer === null) return { ...shared, mySecret: null, hidden: true };
    // 隐私裁剪属于游戏：平台不知道"秘密"是什么，也不会替它藏。
    return { ...shared, mySecret: this.state.secret[viewer] ?? null, hidden: true };
  }

  snapshot(): unknown {
    return { version: 1, config: this.config, state: this.state };
  }
}

export const turnBasedFixture: GameModule = {
  id: 'fixture-turn',
  name: '测试夹具·回合制',
  version: '0.1.0',
  entry: 'client.js',
  seats: { min: 2, max: 6 },
  allowSpectate: true,
  soloFill: true,
  roles: ['host', 'player', 'spectator', 'ai'],
  normalizeConfig: (raw) => normalize(raw) as unknown as Record<string, unknown>,
  rulesHashOf: (config) => stableDigest(config),
  create: (config, ctx) => new TurnInstance(config as unknown as TurnConfig, ctx),
  resume: (snapshot, ctx) => {
    const snap = snapshot as { config: TurnConfig; state: TurnState } | null;
    if (!snap?.state || !snap.config) throw new Error('回合制夹具快照不可用');
    return new TurnInstance(snap.config, ctx, snap.state);
  },
  acceptsSnapshot: (snapshot) => {
    const snap = snapshot as { version?: number } | null;
    return snap?.version === 1;
  },
};

export default turnBasedFixture;
