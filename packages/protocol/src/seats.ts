/** 座位与房间相位：平台的通用形状，不含任何玩法。 */

export const SEAT_ROLES = ['host', 'player', 'spectator', 'ai'] as const;
export type SeatRole = (typeof SEAT_ROLES)[number];

export const ROOM_PHASES = ['lobby', 'playing', 'ended'] as const;
export type RoomPhase = (typeof ROOM_PHASES)[number];

/**
 * 座位视图（下发给客户端的最小形状）。
 * `team` 对平台是不透明标识：war3 式队伍/颜色由游戏模块解释与渲染，
 * 平台只负责存储、按槽位摆放和权限。
 */
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

export interface RoomView {
  code: string;
  name: string;
  gameId: string;
  gameName: string;
  hostSeatId: string | null;
  hostName: string | null;
  phase: RoomPhase;
  seatSlots: number;
  occupied: number;
  allowSpectate: boolean;
  hasPassword: boolean;
  /** 房规摘要，客户端可显示"房主改了设置"。 */
  rulesHash: string;
  createdAt: number;
}

/** 局域网发现信标里的房间条目（UDP 组播载荷，要小）。 */
export interface DiscoveryRoom {
  code: string;
  name: string;
  gameId: string;
  gameName: string;
  phase: RoomPhase;
  occupied: number;
  seatSlots: number;
  hostName: string;
  /** 玩家可直接连的地址，例如 ws://192.168.1.20:3000/  */
  lanUrl: string;
  /** 秒；接收方据此剔除过期条目。 */
  ttl: number;
  hidden: boolean;
}

export const SEAT_SLOT_MIN = 1;

export function isSeatRole(value: unknown): value is SeatRole {
  return typeof value === 'string' && (SEAT_ROLES as readonly string[]).includes(value);
}

export function isRoomPhase(value: unknown): value is RoomPhase {
  return typeof value === 'string' && (ROOM_PHASES as readonly string[]).includes(value);
}
