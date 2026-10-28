import type { PlatformCode } from '@3178/core-abi';
import type { Room, SeatRecord } from './room.js';

/**
 * 权限判定集中在这里，传输层只调用不判断。
 * 旧项目的所有越权都源于"权限散落在每个 case 里"——谁发 start 都能开局。
 */

export type Decision = { ok: true; seat: SeatRecord } | { ok: false; code: PlatformCode; message: string };

const OK_ACTORS: readonly string[] = ['host', 'player'];

export function requireSeat(room: Room, seatId: string | null): Decision {
  if (!seatId) return { ok: false, code: 'NOSEAT', message: '你还没有座位' };
  const seat = room.seat(seatId);
  if (!seat) return { ok: false, code: 'NOSEAT', message: '座位已失效，请重新入座' };
  return { ok: true, seat };
}

export function requirePlayerSeat(room: Room, seatId: string | null): Decision {
  const base = requireSeat(room, seatId);
  if (!base.ok) return base;
  if (!OK_ACTORS.includes(base.seat.role)) {
    return { ok: false, code: 'PHASE', message: '观战席位不能参与对局，可以请房主放你入座' };
  }
  return base;
}

export function requireHost(room: Room, seatId: string | null): Decision {
  const base = requireSeat(room, seatId);
  if (!base.ok) return base;
  if (room.isHost(base.seat.seatId)) return base;
  // 移交之后原房主最容易犯这个错，报错要能解释"你刚才还是"。
  if (room.lastHostSeatId === base.seat.seatId) {
    return { ok: false, code: 'HOSTONLY', message: '房主权限已移交，你不再是房主' };
  }
  return { ok: false, code: 'NOTHOST', message: '只有房主能做这件事' };
}

/**
 * 票据校验的报错一律是 NOSEAT：座位 id 是可猜的，
 * 不能通过错误码告诉外人"这个座位存在、只是票据不对"。
 */
export function requireTicket(room: Room, seatId: string, ticket: string): Decision {
  const seat = room.seat(seatId);
  if (!seat || !room.verifyTicket(seatId, ticket)) {
    return { ok: false, code: 'NOSEAT', message: '座位已失效，请重新加入' };
  }
  return { ok: true, seat };
}

export interface JoinDecision {
  ok: boolean;
  code?: PlatformCode;
  message?: string;
}

export function canJoinAs(room: Room, as: 'player' | 'spectator', password: string | undefined): JoinDecision {
  if (!room.checkPassword(password)) return { ok: false, code: 'PASSWORD', message: '房间密码不对' };
  if (as === 'spectator') {
    if (!room.allowSpectate) return { ok: false, code: 'PHASE', message: '这个房主没开放观战' };
    return { ok: true };
  }
  if (room.phase !== 'lobby') return { ok: false, code: 'PHASE', message: '对局已开始，可以观战或等下一局' };
  if (room.occupied() >= room.seatSlots) return { ok: false, code: 'FULL', message: '房间已满' };
  return { ok: true };
}

/** 开局闸：所有人都要 Ready（房主与 AI 例外），且人数达到游戏下限。 */
export function canBegin(room: Room): JoinDecision {
  if (room.phase === 'playing') return { ok: false, code: 'PHASE', message: '对局已经开始了' };
  if (room.occupied() < room.module.seats.min) {
    return { ok: false, code: 'PHASE', message: `至少 ${room.module.seats.min} 人才能开局，现在 ${room.occupied()} 人` };
  }
  const unready = room.unreadySeats();
  if (unready.length > 0) {
    return {
      ok: false,
      code: 'PHASE',
      message: `还没准备：${unready.map((s) => s.name).join('、')}`,
    };
  }
  return { ok: true };
}
