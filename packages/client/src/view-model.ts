import type { GameManifest, NoticeCode, RoomPhase, RoomView, SeatView, ServerMessage } from '@bp/protocol';

/**
 * 视图模型：把服务端帧流归约成 UI 能直接渲染的一份状态。
 * 纯函数、不碰 DOM，所以 UI 之外的逻辑都能在 node 里测。
 */

export interface ChatLine {
  seatId: string;
  name: string;
  text: string;
  at: number;
  kind: 'say' | 'system';
}

export interface GameEvent {
  name: string;
  payload?: unknown;
  at: number;
}

export interface ViewModel {
  phase: RoomPhase | 'none';
  room: RoomView | null;
  seats: SeatView[];
  game: unknown;
  revision: number;
  serverNow: number;
  chat: ChatLine[];
  events: GameEvent[];
  lastNotice: { code: NoticeCode; text: string } | null;
  lastError: { code: string; message: string } | null;
  mySeatId: string | null;
  ticket: string | null;
  manifest: GameManifest | null;
  availableGames: GameManifest[];
  droppedSnapshots: number;
}

const CHAT_LIMIT = 120;
const EVENT_LIMIT = 40;

export function emptyViewModel(): ViewModel {
  return {
    phase: 'none',
    room: null,
    seats: [],
    game: null,
    revision: 0,
    serverNow: 0,
    chat: [],
    events: [],
    lastNotice: null,
    lastError: null,
    mySeatId: null,
    ticket: null,
    manifest: null,
    availableGames: [],
    droppedSnapshots: 0,
  };
}

export function reduce(state: ViewModel, message: ServerMessage, at: number): ViewModel {
  switch (message.type) {
    case 'welcome':
      return { ...state, availableGames: message.availableGames ?? [], serverNow: message.serverNow };
    case 'seatGranted':
      return {
        ...state,
        mySeatId: message.seatId,
        ticket: message.ticket,
        manifest: message.manifest,
        serverNow: message.serverNow,
        lastError: null,
      };
    case 'snapshot': {
      // revision 去重：重复或乱序的快照直接丢，并留计数供排查。
      if (message.revision !== 0 && message.revision <= state.revision) {
        return { ...state, droppedSnapshots: state.droppedSnapshots + 1 };
      }
      return {
        ...state,
        revision: message.revision,
        serverNow: message.serverNow,
        phase: message.phase,
        room: message.room,
        seats: message.seats,
        game: message.game,
        lastError: null,
      };
    }
    case 'event': {
      const events = [...state.events, { name: message.name, payload: message.payload, at }];
      return { ...state, events: events.slice(-EVENT_LIMIT) };
    }
    case 'chat': {
      const line: ChatLine = { seatId: message.seatId, name: message.name, text: message.text, at: message.at, kind: message.kind };
      return { ...state, chat: [...state.chat, line].slice(-CHAT_LIMIT) };
    }
    case 'notice':
      return { ...state, lastNotice: { code: message.code, text: message.text ?? '' }, chat: state.chat };
    case 'error':
      return { ...state, lastError: { code: message.code, message: message.message } };
    case 'pong':
      return { ...state, serverNow: message.serverNow };
    default:
      return state;
  }
}

export function mySeat(state: ViewModel): SeatView | null {
  if (!state.mySeatId) return null;
  return state.seats.find((s) => s.seatId === state.mySeatId) ?? null;
}

export function isHost(state: ViewModel): boolean {
  const seat = mySeat(state);
  return seat?.role === 'host' || (state.room?.hostSeatId != null && state.room.hostSeatId === state.mySeatId);
}

/** 房主面板的"开局"按钮要不要亮：还要看谁没准备。 */
export function startBlockers(state: ViewModel): { ok: boolean; unready: string[]; tooFew: boolean } {
  const unready = state.seats
    .filter((s) => s.role === 'player' && !s.ready)
    .map((s) => s.name);
  const min = state.manifest?.seats.min ?? 2;
  const players = state.seats.filter((s) => s.role === 'host' || s.role === 'player' || s.role === 'ai').length;
  return { ok: unready.length === 0 && players >= min, unready, tooFew: players < min };
}

const ROLE_TEXT: Record<SeatView['role'], string> = {
  host: '房主',
  player: '玩家',
  spectator: '观战',
  ai: '电脑',
};

/** 只给人看的悬浮说明；界面上的身份符号改用图标字体，不再往文案里塞 emoji。 */
export function seatLabel(seat: SeatView): string {
  const bits = [ROLE_TEXT[seat.role]];
  if (seat.role === 'player' || seat.role === 'host') bits.push(seat.ready ? '已准备' : '未准备');
  if (!seat.connected) bits.push('离线');
  return `${seat.name}（${bits.join(' · ')}）`;
}

export function emptySlots(state: ViewModel): number[] {
  if (!state.room) return [];
  const taken = new Set(state.seats.filter((s) => s.role !== 'spectator').map((s) => s.slot));
  const out: number[] = [];
  for (let slot = 1; slot <= state.room.seatSlots; slot += 1) if (!taken.has(slot)) out.push(slot);
  return out;
}

/** 邀请链接：房主地址 + 房号 + 游戏，发给朋友点开即填好。 */
export function inviteLink(httpOrigin: string, code: string, gameId: string, path = '/ws'): string {
  const params = new URLSearchParams({ h: `${httpOrigin}${path === '/ws' ? '' : path}`, r: code, g: gameId });
  return `${httpOrigin}/?${params.toString()}`;
}
