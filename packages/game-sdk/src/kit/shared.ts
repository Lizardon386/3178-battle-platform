/** 游戏事件流的一条公开记录：玩法文本由游戏填，平台只搬运。 */
export interface FeedEntry {
  seq: number;
  at: number;
  type: string;
  text: string;
  actor?: string;
  target?: string;
  data?: Record<string, unknown>;
}

/** 事件对谁可见；team 需要 FeedLog 提供 seatTeams。 */
export type FeedVisibility = 'all' | { seatId: string } | { team: string | number };

export const FEED_EVENT = 'bp.feed';

export class FeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedError';
  }
}

export interface SeatLike {
  seatId: string;
  slot?: number;
  team?: string | number | null;
}
