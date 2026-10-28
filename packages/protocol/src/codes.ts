import { NOTICE_CODES, PLATFORM_CODES, type NoticeCode, type PlatformCode } from '@lizardon386/core-abi';

export function isPlatformCode(value: unknown): value is PlatformCode {
  return typeof value === 'string' && (PLATFORM_CODES as readonly string[]).includes(value);
}

/** 默认文案：客户端不认识某个码时也能显示人话。 */
export const CODE_MESSAGES: Record<PlatformCode, string> = {
  PROTOCOL: '平台版本与房主不匹配，请更新后重进',
  VERSION: '游戏版本与房主不同，请更新',
  RULES: '玩法设置与房主不一致（房规/地图校验失败）',
  UNKNOWN_GAME: '房主玩的游戏你这里没有',
  NOROOM: '房间不存在或已结束',
  NOSEAT: '座位已失效，请重新入座',
  FULL: '房间已满',
  NOTHOST: '只有房主能做这件事',
  HOSTONLY: '房主权限已被移交，你不再是房主',
  PASSWORD: '房间密码不对',
  PHASE: '当前房间状态不允许该操作',
  RATE: '操作太快，稍等一下',
  SEATLOST: '该座位被本人重新占用',
  BADMSG: '消息格式不对',
  INTERNAL: '房主端出了点问题，请把这条信息发给房主',
};

/** 一次性通知码（不是一行聊天，是要玩家看见的事件）。 */
export const NOTICE_MESSAGES: Record<NoticeCode, string> = {
  HOSTLEFT: '主机已退出，本局结束',
  HOST_CHANGED: '房主已移交给别的玩家',
  ROOM_CLOSED: '房主关闭了房间',
  SEAT_EJECTED: '你被房主请出了座位',
  RULES_MISMATCH: '房主换了玩法设置，需要重新开局',
  REJOINED: '有设备用同一票据重新连上了这个座位',
  TOO_FEW: '在线人数不足，本局结束',
};
