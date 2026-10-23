import type { GameManifest, NoticeCode, PlatformCode, RoomPhase, SeatRole, SeatView } from '@bp/core-abi';
import type { RoomView } from './seats.js';

/**
 * 线协议：所有消息都是扁平 JSON 对象，靠 `type` 分支。
 * 设计约束：平台只认这些类型；玩法自己的动作一律塞 `gameAction.name`，
 * 平台不看内容，只做席位鉴权与投递。
 */

export interface ClientHello {
  type: 'hello';
  protocol: number;
  nick: string;
  /** 客户端本地已装的游戏及其房规摘要；带了服务端就能在入房前告诉你版本不对。 */
  gameId?: string;
  version?: string;
  rulesHash?: string;
}

export interface ClientRoomCreate {
  type: 'roomCreate';
  gameId: string;
  roomName: string;
  seatSlots: number;
  /** 交给游戏模块 create() 的房规；平台只算摘要。 */
  config?: Record<string, unknown>;
  password?: string;
  /** 隐藏房：不发局域网信标，只能靠邀请链接进。 */
  hidden?: boolean;
  allowSpectate?: boolean;
}

export interface ClientRoomJoin {
  type: 'roomJoin';
  code: string;
  password?: string;
  as?: 'player' | 'spectator';
  /** 指定入座槽位；不填则给最小空槽。 */
  slot?: number;
}

export interface ClientSeatResume {
  type: 'seatResume';
  code: string;
  seatId: string;
  /** 入席时下发的票据，丢了就只能重新入座（修掉旧项目"猜房号+座位号即占座"）。 */
  ticket: string;
}

export interface ClientSeatLeave {
  type: 'seatLeave';
}

export interface ClientReady {
  type: 'ready';
  ready: boolean;
}

export interface ClientGameAction {
  type: 'gameAction';
  name: string;
  payload?: unknown;
}

export interface ClientChat {
  type: 'chat';
  text: string;
}

export interface ClientHostStart {
  type: 'hostStart';
}

export interface ClientHostClose {
  type: 'hostClose';
  reason?: string;
}

export interface ClientHostKick {
  type: 'hostKick';
  seatId: string;
}

export interface ClientHostTransfer {
  type: 'hostTransfer';
  seatId: string;
}

export interface ClientHostSeat {
  type: 'hostSeat';
  op: 'addAi' | 'removeAi' | 'move' | 'setTeam';
  seatId?: string;
  slot?: number;
  team?: string | number | null;
}

export interface ClientResync {
  type: 'resync';
  since: number;
}

export interface ClientPing {
  type: 'ping';
  nonce: string;
}

export type ClientMessage =
  | ClientHello
  | ClientRoomCreate
  | ClientRoomJoin
  | ClientSeatResume
  | ClientSeatLeave
  | ClientReady
  | ClientGameAction
  | ClientChat
  | ClientHostStart
  | ClientHostClose
  | ClientHostKick
  | ClientHostTransfer
  | ClientHostSeat
  | ClientResync
  | ClientPing;

export type ClientMessageType = ClientMessage['type'];

export const CLIENT_MESSAGE_TYPES: readonly ClientMessageType[] = [
  'hello',
  'roomCreate',
  'roomJoin',
  'seatResume',
  'seatLeave',
  'ready',
  'gameAction',
  'chat',
  'hostStart',
  'hostClose',
  'hostKick',
  'hostTransfer',
  'hostSeat',
  'resync',
  'ping',
];

/** 需要房主权限的命令。传输层按这张表做统一鉴权。 */
export const HOST_COMMANDS = ['hostStart', 'hostClose', 'hostKick', 'hostTransfer', 'hostSeat'] as const;
export type HostCommand = (typeof HOST_COMMANDS)[number];

export function isHostCommand(type: string): type is HostCommand {
  return (HOST_COMMANDS as readonly string[]).includes(type);
}

export interface ServerWelcome {
  type: 'welcome';
  protocol: number;
  serverNow: number;
  /** 房主机器上装了哪些游戏，客户端据此渲染列表并判断"要不要向你索要模块"。 */
  availableGames: GameManifest[];
}

export interface ServerSeatGranted {
  type: 'seatGranted';
  code: string;
  seatId: string;
  ticket: string;
  role: SeatRole;
  slot: number;
  hostSeatId: string | null;
  serverNow: number;
  manifest: GameManifest;
}

export interface ServerSnapshot {
  type: 'snapshot';
  /** 单调递增；客户端据此去重与 resync。 */
  revision: number;
  /** 服务端毫秒时间戳；deadline 一律相对它，客户端不许拿本地钟比绝对时间。 */
  serverNow: number;
  room: RoomView;
  seats: SeatView[];
  phase: RoomPhase;
  /** 游戏模块按视角裁剪后的状态；平台不看内容。 */
  game: unknown;
}

export interface ServerEvent {
  type: 'event';
  name: string;
  payload?: unknown;
}

export interface ServerChat {
  type: 'chat';
  seatId: string;
  name: string;
  text: string;
  at: number;
  kind: 'say' | 'system';
}

export interface ServerNotice {
  type: 'notice';
  code: NoticeCode;
  text?: string;
}

export interface ServerError {
  type: 'error';
  code: PlatformCode;
  message: string;
}

export interface ServerPong {
  type: 'pong';
  nonce: string;
  serverNow: number;
}

export type ServerMessage =
  | ServerWelcome
  | ServerSeatGranted
  | ServerSnapshot
  | ServerEvent
  | ServerChat
  | ServerNotice
  | ServerError
  | ServerPong;

export type ServerMessageType = ServerMessage['type'];

export const SERVER_MESSAGE_TYPES = [
  'welcome',
  'seatGranted',
  'snapshot',
  'event',
  'chat',
  'notice',
  'error',
  'pong',
] as const;

/** 供文档与契约测试使用的形状说明。 */
export interface MessageCatalogEntry {
  direction: 'c2s' | 's2c';
  type: string;
  requiresSeat: boolean;
  requiresHost: boolean;
  note: string;
}

export const MESSAGE_CATALOG: MessageCatalogEntry[] = [
  { direction: 'c2s', type: 'hello', requiresSeat: false, requiresHost: false, note: '连接后第一条；带 protocol/nick 与本地已装游戏' },
  { direction: 'c2s', type: 'roomCreate', requiresSeat: false, requiresHost: false, note: '建房者即房主' },
  { direction: 'c2s', type: 'roomJoin', requiresSeat: false, requiresHost: false, note: '房号 + 可选密码/槽位' },
  { direction: 'c2s', type: 'seatResume', requiresSeat: false, requiresHost: false, note: '必须带票据' },
  { direction: 'c2s', type: 'seatLeave', requiresSeat: true, requiresHost: false, note: '离座；房主离座走 hostClose/Transfer' },
  { direction: 'c2s', type: 'ready', requiresSeat: true, requiresHost: false, note: 'war3 式准备状态，未 Ready 不开局' },
  { direction: 'c2s', type: 'gameAction', requiresSeat: true, requiresHost: false, note: '玩法动作，平台不解释' },
  { direction: 'c2s', type: 'chat', requiresSeat: true, requiresHost: false, note: '房间频道，限流' },
  { direction: 'c2s', type: 'hostStart', requiresSeat: true, requiresHost: true, note: '开始对局' },
  { direction: 'c2s', type: 'hostClose', requiresSeat: true, requiresHost: true, note: '关房/终局' },
  { direction: 'c2s', type: 'hostKick', requiresSeat: true, requiresHost: true, note: '请出座位' },
  { direction: 'c2s', type: 'hostTransfer', requiresSeat: true, requiresHost: true, note: '只移权限，不迁进程' },
  { direction: 'c2s', type: 'hostSeat', requiresSeat: true, requiresHost: true, note: 'AI 填充/换槽/改队' },
  { direction: 'c2s', type: 'resync', requiresSeat: true, requiresHost: false, note: '快照 revision 断了时索取' },
  { direction: 'c2s', type: 'ping', requiresSeat: false, requiresHost: false, note: 'RTT 与校时' },
  { direction: 's2c', type: 'welcome', requiresSeat: false, requiresHost: false, note: '握手通过' },
  { direction: 's2c', type: 'seatGranted', requiresSeat: false, requiresHost: false, note: '下发票据，客户端须持久化' },
  { direction: 's2c', type: 'snapshot', requiresSeat: false, requiresHost: false, note: '按视角裁剪的全量状态' },
  { direction: 's2c', type: 'event', requiresSeat: false, requiresHost: false, note: '玩法事件与平台事件共用' },
  { direction: 's2c', type: 'chat', requiresSeat: false, requiresHost: false, note: '含系统消息' },
  { direction: 's2c', type: 'notice', requiresSeat: false, requiresHost: false, note: '主机已退出等一次性提示' },
  { direction: 's2c', type: 'error', requiresSeat: false, requiresHost: false, note: '平台错误码' },
  { direction: 's2c', type: 'pong', requiresSeat: false, requiresHost: false, note: '带 serverNow' },
];

/** 房间视图由平台组装，玩法无关。 */
export type { RoomView };
