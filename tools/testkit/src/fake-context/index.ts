import type { GameContext, GameSeatInfo } from '@3178/game-sdk';

export interface FakeContextOptions {
  roomCode?: string;
  config?: Record<string, unknown>;
  seats: Array<Partial<GameSeatInfo> & { seatId: string; name: string }>;
  now?: () => number;
  random?: () => number;
}

/** 直接调用 GameModule 的测试用上下文；不经过房间、socket 或落盘。 */
export function makeFakeContext(options: FakeContextOptions): GameContext {
  const seats: GameSeatInfo[] = options.seats.map((seat, index) => ({
    seatId: seat.seatId,
    name: seat.name,
    slot: seat.slot ?? index + 1,
    role: seat.role ?? 'player',
    team: seat.team ?? null,
    ready: seat.ready ?? true,
    connected: seat.connected ?? true,
  }));
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? (() => Math.random());
  return {
    roomCode: options.roomCode ?? 'TEST',
    config: options.config ?? {},
    now,
    random,
    seats: () => seats,
    seat: (seatId: string) => seats.find((seat) => seat.seatId === seatId),
  };
}
