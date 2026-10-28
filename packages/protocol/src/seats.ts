import { ROOM_PHASES, SEAT_ROLES, type RoomPhase, type SeatRole } from '@lizardon386/core-abi';

/** 房间视图和局域网发现条目；座位/相位的基础类型在 @lizardon386/core-abi。 */

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
