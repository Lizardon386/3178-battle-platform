import { CLIENT_MESSAGE_TYPES, SERVER_MESSAGE_TYPES, type ClientMessage, type ServerMessage } from './wire.js';

/**
 * 入站消息的形状闸门。消息来自别人的机器，所以先验形状再解释语义；
 * 长度上限同时挡住"一个客户端把房主内存吃光"这类误操作。
 */

export const LIMITS = {
  nick: 32,
  code: 12,
  roomName: 48,
  password: 32,
  chat: 300,
  actionName: 40,
  gameId: 32,
  hash: 64,
  ticket: 128,
} as const;

type Kind = 'str' | 'int' | 'num' | 'bool' | 'any' | 'obj';

const str = (v: unknown, max: number): boolean =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const plainStr = (v: unknown, max: number): boolean => typeof v === 'string' && v.length <= max;

const SPEC: Record<string, Record<string, Kind | `${Kind}?`>> = {
  hello: { protocol: 'int', nick: 'str', gameId: 'str?', version: 'str?', rulesHash: 'str?' },
  roomCreate: {
    gameId: 'str',
    roomName: 'str',
    seatSlots: 'int',
    config: 'obj?',
    password: 'str?',
    hidden: 'bool?',
    allowSpectate: 'bool?',
  },
  roomJoin: { code: 'str', password: 'str?', as: 'str?', slot: 'int?' },
  seatResume: { code: 'str', seatId: 'str', ticket: 'str' },
  seatLeave: {},
  ready: { ready: 'bool' },
  gameAction: { name: 'str', payload: 'any?' },
  chat: { text: 'str' },
  hostStart: {},
  hostClose: { reason: 'str?' },
  hostKick: { seatId: 'str' },
  hostTransfer: { seatId: 'str' },
  hostSeat: { op: 'str', seatId: 'str?', slot: 'int?', team: 'any?' },
  resync: { since: 'int' },
  ping: { nonce: 'str' },
  // 服务端消息（客户端也要能挡住乱序/伪造的帧）
  welcome: { protocol: 'int', serverNow: 'num', availableGames: 'any?' },
  seatGranted: {
    code: 'str',
    seatId: 'str',
    ticket: 'str',
    role: 'str',
    slot: 'int',
    hostSeatId: 'any?',
    serverNow: 'num',
    manifest: 'any',
  },
  snapshot: { revision: 'int', serverNow: 'num', room: 'obj', seats: 'any', phase: 'str', game: 'any?' },
  event: { name: 'str', payload: 'any?' },
  chat$server: { seatId: 'str', name: 'str', text: 'str', at: 'num', kind: 'str' },
  notice: { code: 'str', text: 'str?' },
  error: { code: 'str', message: 'str' },
  pong: { nonce: 'str', serverNow: 'num' },
};

const MAXLEN: Record<string, number> = {
  nick: LIMITS.nick,
  code: LIMITS.code,
  roomName: LIMITS.roomName,
  password: LIMITS.password,
  text: LIMITS.chat,
  name: LIMITS.actionName,
  gameId: LIMITS.gameId,
  rulesHash: LIMITS.hash,
  version: LIMITS.hash,
  ticket: LIMITS.ticket,
  seatId: LIMITS.ticket,
  nonce: LIMITS.hash,
};

export type ParseResult<T> = { ok: true; message: T } | { ok: false; reason: string };

function fieldOk(value: unknown, kind: Kind, key: string): boolean {
  switch (kind) {
    case 'str':
      return str(value, MAXLEN[key] ?? 64);
    case 'int':
      return typeof value === 'number' && Number.isSafeInteger(value);
    case 'num':
      return typeof value === 'number' && Number.isFinite(value);
    case 'bool':
      return typeof value === 'boolean';
    case 'obj':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'any':
      return true;
  }
}

function check(obj: Record<string, unknown>, spec: Record<string, string>): string | null {
  for (const [key, kind] of Object.entries(spec)) {
    const optional = kind.endsWith('?');
    const base = (optional ? kind.slice(0, -1) : kind) as Kind;
    const value = obj[key];
    if (value === undefined) {
      if (!optional) return `缺字段 ${key}`;
      continue;
    }
    if (!fieldOk(value, base, key)) return `字段 ${key} 形状不对`;
  }
  for (const key of Object.keys(obj)) {
    if (key === 'type') continue;
    if (!(key in spec)) return `多余字段 ${key}`;
  }
  return null;
}

/** 座位类消息允许 'chat' 走服务端形状；这里只解析入站方向。 */
function parseDirection(raw: unknown, allowed: readonly string[], serverSide: boolean): ParseResult<unknown> {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ok: false, reason: '不是合法 JSON' };
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: '消息必须是 JSON 对象' };
  }
  const obj = raw as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== 'string') return { ok: false, reason: '缺 type' };
  if (!allowed.includes(type)) return { ok: false, reason: `未知消息类型 ${type}` };
  const specKey = serverSide && type === 'chat' ? 'chat$server' : type;
  const spec = SPEC[specKey];
  if (!spec) return { ok: false, reason: `${type} 无形状定义` };
  const problem = check(obj, spec);
  if (problem) return { ok: false, reason: `${type}: ${problem}` };
  return { ok: true, message: obj };
}

export function parseClientMessage(raw: unknown): ParseResult<ClientMessage> {
  return parseDirection(raw, CLIENT_MESSAGE_TYPES, false) as ParseResult<ClientMessage>;
}

export function parseServerMessage(raw: unknown): ParseResult<ServerMessage> {
  return parseDirection(raw, SERVER_MESSAGE_TYPES, true) as ParseResult<ServerMessage>;
}

/** 明文房号规范化：大小写不敏感、去空格。 */
export function normalizeCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export { plainStr as isBoundedString };
