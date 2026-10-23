/** 游戏 ABI 和客户端都认的座位/相位形状；平台的房间视图另在 protocol。 */

export const SEAT_ROLES = ['host', 'player', 'spectator', 'ai'] as const;
export type SeatRole = (typeof SEAT_ROLES)[number];

export const ROOM_PHASES = ['lobby', 'playing', 'ended'] as const;
export type RoomPhase = (typeof ROOM_PHASES)[number];

/** 座位视图（下发给客户端和游戏界面）。 */
export interface SeatView {
  seatId: string;
  slot: number;
  name: string;
  role: SeatRole;
  ready: boolean;
  connected: boolean;
  /** 距上次心跳的毫秒数；离线座位为 null。 */
  ageMs: number | null;
  team: string | number | null;
  /** 是否为房主座位（role==='host' 的冗余标记，便于前端画 🎮）。 */
  isHost: boolean;
}
