import { reject, stableDigest, type GameContext, type GameInstance, type GameModule, type Outcome, type ViewerId } from '@3178/game-sdk';
import { FeedLog } from '@3178/game-sdk/kit/server';

/** 测试夹具：给 game-kit 客户端面板用的最小对局，不参与契约测试的回合语义断言。 */

class KitGame implements GameInstance {
  private count = 0;
  private readonly ctx: GameContext;
  private readonly feed: FeedLog;

  constructor(ctx: GameContext, saved?: unknown) {
    this.ctx = ctx;
    const data = saved as { count?: number; feed?: unknown } | undefined;
    this.count = data?.count ?? 0;
    this.feed = new FeedLog({
      max: 50,
      now: () => this.ctx.now(),
      seatTeams: () => this.ctx.seats().map((seat) => ({ seatId: seat.seatId, team: seat.team })),
    });
    if (data?.feed) this.feed.restore(data.feed);
  }

  private nameOf(seatId: string): string {
    return this.ctx.seat(seatId)?.name ?? seatId;
  }

  serialize(viewer: ViewerId): unknown {
    return {
      title: '测试夹具·game-kit 界面',
      viewer,
      count: this.count,
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
      feed: this.feed.viewFor(viewer),
    };
  }

  begin(): Outcome {
    this.feed.emit({ type: 'game', text: 'game-kit 测试对局开始' });
    return [
      { kind: 'system', text: 'game-kit 测试对局开始' },
      ...this.feed.drainEffects(),
    ];
  }

  handle(action: { name: string }, by: string): Outcome {
    if (action.name === 'bump') {
      this.count += 1;
      const entry = this.feed.emit({
        type: 'bump',
        text: `${this.nameOf(by)} 推进到第 ${this.count} 手`,
        actor: by,
        data: { count: this.count },
      });
      return [
        { kind: 'broadcast', name: 'bump', payload: { count: this.count, feedSeq: entry.seq } },
        ...this.feed.drainEffects(),
        { kind: 'system', text: `轮到下一手（${this.count}）` },
      ];
    }
    return reject('game-kit 夹具拒绝这个动作', 'BADMSG');
  }

  snapshot(): unknown {
    return { version: 1, count: this.count, feed: this.feed.snapshot() };
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
  acceptsSnapshot: (snapshot) => (snapshot as { version?: number } | null)?.version === 1,
};

export default kitGame;
