import { stableDigest, type GameContext, type GameInstance, type GameModule, type Outcome } from '@bp/game-sdk';

/** 测试夹具：给 game-kit 客户端面板用的最小对局，不参与契约测试的回合语义断言。 */

class KitGame implements GameInstance {
  private count = 0;
  private readonly ctx: GameContext;

  constructor(ctx: GameContext, saved?: unknown) {
    this.ctx = ctx;
    this.count = (saved as { count?: number } | undefined)?.count ?? 0;
  }

  serialize(viewer: string | null): unknown {
    return {
      title: '测试夹具·game-kit 界面',
      viewer,
      scoreboard: {
        rows: this.ctx.seats().map((seat, index) => ({
          seatId: seat.seatId,
          values: {
            score: this.count + index + 1,
            hand: index + 2,
            state: seat.ready ? 'ready' : 'wait',
          },
        })),
      },
    };
  }

  begin(): Outcome {
    return [{ kind: 'system', text: 'game-kit 测试对局开始' }];
  }

  handle(action: { name: string }): Outcome {
    if (action.name !== 'bump') return [];
    this.count += 1;
    return [
      { kind: 'broadcast', name: 'bump', payload: { count: this.count } },
      { kind: 'system', text: `轮到下一手（${this.count}）` },
    ];
  }

  snapshot(): unknown {
    return { count: this.count };
  }
}

export const kitGame: GameModule = {
  id: 'fixture-kit',
  name: '测试夹具·game-kit 界面',
  version: '0.1.0',
  entry: 'client.js',
  seats: { min: 1, max: 2 },
  allowSpectate: true,
  soloFill: true,
  roles: ['host', 'player', 'ai', 'spectator'],
  ui: { chat: 'game' },
  normalizeConfig: () => ({}),
  rulesHashOf: (config) => stableDigest(config),
  create: (_config, ctx) => new KitGame(ctx),
  resume: (snapshot, ctx) => new KitGame(ctx, snapshot),
};

export default kitGame;
