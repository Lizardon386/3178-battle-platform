import { stableDigest, type Effect, type GameContext, type GameInstance, type GameModule, type Outcome, type ViewerId } from '@3178/game-sdk';

/**
 * 测试夹具：**没有回合游标、没有隐私状态、所有人同时操作**的协作计数。
 * 它存在的意义是证伪"平台按回合制抽象"：如果内核里还藏着"当前行动者"这类假设，
 * 这个模块就接不上。
 */

interface CountConfig {
  goal: number;
  limitMs: number;
}

interface CountState {
  value: number;
  deadline: number;
  outcome: 'win' | 'bust' | 'timeout' | null;
  presses: Record<string, number>;
}

function normalize(raw: Record<string, unknown> | undefined): CountConfig {
  const num = (v: unknown, min: number, max: number, dft: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : dft;
  return { goal: num(raw?.goal, 3, 500, 20), limitMs: num(raw?.limitMs, 2_000, 600_000, 60_000) };
}

class CountInstance implements GameInstance {
  private state: CountState;

  constructor(private readonly config: CountConfig, private readonly ctx: GameContext, state?: CountState) {
    this.state = state ?? { value: 0, deadline: 0, outcome: null, presses: {} };
  }

  begin(): Outcome {
    this.state = {
      value: 0,
      deadline: this.ctx.now() + this.config.limitMs,
      outcome: null,
      presses: Object.fromEntries(this.ctx.seats().map((s) => [s.seatId, 0])),
    };
    return [{ kind: 'system', text: `一起把数加到 ${this.config.goal}，超过就输，限时 ${(this.config.limitMs / 1000) | 0} 秒` }];
  }

  private settle(): Effect[] {
    const text =
      this.state.outcome === 'win'
        ? `正好 ${this.config.goal}，全员通过`
        : this.state.outcome === 'bust'
          ? `超过 ${this.config.goal}，失败了`
          : '时间到，没凑上数';
    return [
      { kind: 'broadcast', name: 'gameOver', payload: { outcome: this.state.outcome } },
      { kind: 'end', reason: text },
    ];
  }

  handle(action: { name: string }, by: string): Outcome {
    if (this.state.outcome) return { reject: '这局已经结束了', code: 'PHASE' };
    if (action.name !== 'plus' && action.name !== 'minus') {
      return { reject: `数数玩法只有 plus/minus 两个动作：${action.name}`, code: 'BADMSG' };
    }
    this.state.presses[by] = (this.state.presses[by] ?? 0) + 1;
    this.state.value += action.name === 'plus' ? 1 : -1;
    const effects: Effect[] = [{ kind: 'broadcast', name: 'step', payload: { by, value: this.state.value } }];
    if (this.state.value > this.config.goal) {
      this.state.outcome = 'bust';
      effects.push(...this.settle());
    } else if (this.state.value === this.config.goal) {
      this.state.outcome = 'win';
      effects.push(...this.settle());
    }
    return effects;
  }

  tick(now: number): Effect[] {
    if (this.state.outcome || now < this.state.deadline) return [];
    this.state.outcome = 'timeout';
    return this.settle();
  }

  /** 没有回合概念，所以不实现 onTimeout；有人走了也只是少个人按。 */
  onSeatLeave(seat: { seatId: string; name: string }): Effect[] {
    delete this.state.presses[seat.seatId];
    return [{ kind: 'system', text: `${seat.name} 离开，剩下的人继续` }];
  }

  /** viewer 参数在这里被完全忽略——公开协作游戏没有视角差异。 */
  serialize(_viewer: ViewerId): unknown {
    return {
      kind: 'count',
      value: this.state.value,
      goal: this.config.goal,
      remainingMs: Math.max(0, this.state.deadline - this.ctx.now()),
      outcome: this.state.outcome,
      presses: Object.entries(this.state.presses).map(([seatId, n]) => ({ seatId, n })),
    };
  }

  snapshot(): unknown {
    return { version: 1, config: this.config, state: this.state };
  }
}

export const simultaneousFixture: GameModule = {
  id: 'fixture-simultaneous',
  name: '测试夹具·同时操作',
  version: '0.1.0',
  entry: 'client.js',
  seats: { min: 2, max: 8 },
  allowSpectate: true,
  soloFill: false,
  roles: ['host', 'player', 'spectator'],
  normalizeConfig: (raw) => normalize(raw) as unknown as Record<string, unknown>,
  rulesHashOf: (config) => stableDigest(config),
  create: (config, ctx) => new CountInstance(config as unknown as CountConfig, ctx),
  resume: (snapshot, ctx) => {
    const snap = snapshot as { config: CountConfig; state: CountState } | null;
    if (!snap?.state || !snap.config) throw new Error('数数快照不可用');
    return new CountInstance(snap.config, ctx, snap.state);
  },
  acceptsSnapshot: (snapshot) => (snapshot as { version?: number } | null)?.version === 1,
};

export default simultaneousFixture;
