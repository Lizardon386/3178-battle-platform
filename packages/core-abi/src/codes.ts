/** 平台错误码和通知码：游戏会用到，放进 ABI；默认文案留在 protocol。 */

export const PLATFORM_CODES = [
  'PROTOCOL',
  'VERSION',
  'RULES',
  'UNKNOWN_GAME',
  'NOROOM',
  'NOSEAT',
  'FULL',
  'NOTHOST',
  'HOSTONLY',
  'PASSWORD',
  'PHASE',
  'RATE',
  'SEATLOST',
  'BADMSG',
  'INTERNAL',
] as const;

export type PlatformCode = (typeof PLATFORM_CODES)[number];

export const NOTICE_CODES = [
  'HOSTLEFT',
  'HOST_CHANGED',
  'ROOM_CLOSED',
  'SEAT_EJECTED',
  'RULES_MISMATCH',
  'REJOINED',
  'TOO_FEW',
] as const;

export type NoticeCode = (typeof NOTICE_CODES)[number];
