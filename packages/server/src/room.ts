import { hashSecret, newSeatId, newTicket, secretMatches } from './ids.js';
import type { GameAsset, GameInstance, GameManifest, GameModule, GameSeatInfo, RoomPhase, SeatRole, SeatView } from './module-api.js';
import { manifestOf } from './module-api.js';
import type { RoomView } from '@bp/protocol';

/** 传输层的最小投影：房间不许知道 ws 的存在。 */
export interface TransportHandle {
  send(raw: string): void;
  close(code?: number, reason?: string): void;
}

export interface SeatRecord {
  seatId: string;
  slot: number;
  name: string;
  role: SeatRole;
  ready: boolean;
  team: string | number | null;
  /** 票据摘要。原始票据只在 seatGranted 里下发一次，落盘也不存明文。 */
  secretHash: string | null;
  connected: boolean;
  disconnectedAt: number | null;
  lastSeenAt: number;
  transport: TransportHandle | null;
  isAi: boolean;
}

export interface ChatEntry {
  seatId: string;
  name: string;
  text: string;
  at: number;
  kind: 'say' | 'system';
}

export interface RoomSpec {
  code: string;
  name: string;
  module: GameModule;
  /** 单文件包下发的文件清单；目录游戏没有。 */
  assets?: readonly GameAsset[];
  rawConfig: Record<string, unknown> | undefined;
  seatSlots: number;
  password: string | null;
  hidden: boolean;
  allowSpectate: boolean;
  now: number;
}

export type SeatStatus = 'ok' | 'full' | 'badticket' | 'notfound';

/** 落盘用的房间形状：座位不含 transport，游戏状态由调用方另存。 */
export interface RoomExport {
  code: string;
  createdAt: number;
  updatedAt: number;
  phase: RoomPhase;
  revision: number;
  name: string;
  hostSeatId: string | null;
  lastHostSeatId: string | null;
  seats: Array<Omit<SeatRecord, 'transport'>>;
  chat: ChatEntry[];
  /** 房间密码摘要；不存的话重启后密码房会变成公开房。 */
  secretHash: string | null;
  seatSlots: number;
  hidden: boolean;
  allowSpectate: boolean;
}

const CHAT_HISTORY = 200;
const MAX_SPECTATORS = 8;

/**
 * 房间 = 座位表 + 房主权限 + 聊天 + 一个 opaque 的游戏实例。
 * 这里没有任何玩法字段；对局状态一律在 `game` 里，平台只负责序列化与投递。
 */
export class Room {
  readonly code: string;
  createdAt: number;
  name: string;
  phase: RoomPhase = 'lobby';
  revision = 0;
  updatedAt: number;
  readonly seatSlots: number;
  readonly gameId: string;
  readonly gameName: string;
  readonly manifest: GameManifest;
  readonly config: Record<string, unknown>;
  readonly rulesHash: string;
  readonly allowSpectate: boolean;
  readonly hidden: boolean;
  readonly module: GameModule;

  private secretRef: string | null;
  private readonly seatsRef: SeatRecord[] = [];
  private chatRef: ChatEntry[] = [];
  private hostSeatRef: string | null = null;
  private lastHostSeatRef: string | null = null;
  private gameRef: GameInstance | null = null;
  private readonly clock: () => number;

  constructor(spec: RoomSpec, clock?: () => number) {
    this.code = spec.code;
    this.name = spec.name;
    this.createdAt = spec.now;
    this.updatedAt = spec.now;
    this.gameId = spec.module.id;
    this.gameName = spec.module.name;
    this.config = spec.module.normalizeConfig(spec.rawConfig);
    this.manifest = manifestOf(spec.module, this.config, spec.assets);
    this.rulesHash = this.manifest.rulesHash;
    this.seatSlots = Math.max(spec.module.seats.min, Math.min(spec.seatSlots, spec.module.seats.max));
    this.secretRef = spec.password ? hashSecret(spec.password) : null;
    this.hidden = spec.hidden;
    this.allowSpectate = spec.allowSpectate && spec.module.allowSpectate;
    this.module = spec.module;
    this.clock = clock ?? (() => Date.now());
  }

  get seats(): readonly SeatRecord[] {
    return this.seatsRef;
  }

  get chat(): readonly ChatEntry[] {
    return this.chatRef;
  }

  get hostSeatId(): string | null {
    return this.hostSeatRef;
  }

  /** 房间密码只以摘要形式存在，落盘的也是摘要。 */
  get secretHash(): string | null {
    return this.secretRef;
  }

  /** 上一个房主。用来把"你从来没当过房主"和"你的房主权限刚被移走"分开报错。 */
  get lastHostSeatId(): string | null {
    return this.lastHostSeatRef;
  }

  get game(): GameInstance | null {
    return this.gameRef;
  }

  setGame(instance: GameInstance | null): void {
    this.gameRef = instance;
  }

  now(): number {
    return this.clock();
  }

  bump(): number {
    this.revision += 1;
    this.updatedAt = this.now();
    return this.revision;
  }

  touch(): void {
    this.updatedAt = this.now();
  }

  checkPassword(password: string | undefined): boolean {
    if (!this.secretRef) return true;
    return typeof password === 'string' && secretMatches(this.secretRef, password);
  }

  seat(seatId: string): SeatRecord | undefined {
    return this.seatsRef.find((s) => s.seatId === seatId);
  }

  seatBySlot(slot: number): SeatRecord | undefined {
    return this.seatsRef.find((s) => s.slot === slot && s.role !== 'spectator');
  }

  occupied(): number {
    return this.seatsRef.filter((s) => s.role === 'host' || s.role === 'player' || s.role === 'ai').length;
  }

  spectators(): number {
    return this.seatsRef.filter((s) => s.role === 'spectator').length;
  }

  /** 人类座位里还差谁 Ready——房主点开局时平台用这道闸。 */
  unreadySeats(): SeatView[] {
    return this.seatsRef
      .filter((s) => !s.isAi && s.role !== 'spectator' && s.seatId !== this.hostSeatRef && !s.ready)
      .map((s) => this.seatView(s.seatId))
      .filter((s): s is SeatView => s !== null);
  }

  connectedPlayers(): number {
    return this.seatsRef.filter((s) => s.connected && (s.role === 'host' || s.role === 'player')).length;
  }

  hasHumanConnected(): boolean {
    return this.seatsRef.some((s) => s.connected && !s.isAi && s.role !== 'spectator');
  }

  private freeSlot(): number {
    for (let slot = 1; slot <= this.seatSlots; slot += 1) {
      if (!this.seatBySlot(slot)) return slot;
    }
    return this.seatSlots;
  }

  private makeSeat(name: string, role: SeatRole, slot: number, isAi: boolean): SeatRecord {
    return {
      seatId: newSeatId(),
      slot,
      name,
      role,
      ready: false,
      team: null,
      secretHash: null,
      connected: !isAi,
      disconnectedAt: null,
      lastSeenAt: this.now(),
      transport: null,
      isAi,
    };
  }

  /** 入座并下发票据。房主第一席在建房时占用 1 号槽。 */
  addSeat(input: { name: string; role: SeatRole; transport?: TransportHandle | null; slot?: number; isAi?: boolean }):
    { ok: true; seat: SeatRecord; ticket: string } | { ok: false; status: SeatStatus } {
    const isAi = input.isAi ?? input.role === 'ai';
    if (isAi && !this.module.soloFill) return { ok: false, status: 'full' };
    if (input.role === 'spectator') {
      if (this.spectators() >= MAX_SPECTATORS) return { ok: false, status: 'full' };
    } else if (this.occupied() >= this.seatSlots) {
      return { ok: false, status: 'full' };
    }
    const slot = input.role === 'spectator' ? 900 + this.spectators() + 1 : (input.slot ?? this.freeSlot());
    if (input.slot !== undefined && this.seatBySlot(slot)) return { ok: false, status: 'full' };
    const seat = this.makeSeat(input.name, input.role, slot, isAi);
    const ticket = isAi ? '' : newTicket();
    if (!isAi) seat.secretHash = hashSecret(ticket);
    this.seatsRef.push(seat);
    if (input.transport) seat.transport = input.transport;
    if (input.role === 'host') this.hostSeatRef = seat.seatId;
    this.bump();
    return { ok: true, seat, ticket };
  }

  verifyTicket(seatId: string, ticket: string): boolean {
    const seat = this.seat(seatId);
    if (!seat?.secretHash) return false;
    return secretMatches(seat.secretHash, ticket);
  }

  attach(seatId: string, transport: TransportHandle): void {
    const seat = this.seat(seatId);
    if (!seat) return;
    seat.transport = transport;
    seat.connected = true;
    seat.disconnectedAt = null;
    seat.lastSeenAt = this.now();
    this.bump();
  }

  detach(seatId: string, transport: TransportHandle): boolean {
    const seat = this.seat(seatId);
    // 守卫：只有当前 socket 还是这个座位的连接时才置离线，防止重连后被旧 socket 踢掉。
    if (!seat || seat.transport !== transport) return false;
    seat.transport = null;
    seat.connected = false;
    seat.disconnectedAt = this.now();
    this.bump();
    return true;
  }

  removeSeat(seatId: string): SeatRecord | undefined {
    const index = this.seatsRef.findIndex((s) => s.seatId === seatId);
    if (index < 0) return undefined;
    const [removed] = this.seatsRef.splice(index, 1);
    if (removed && this.hostSeatRef === removed.seatId) this.hostSeatRef = null;
    this.bump();
    return removed;
  }

  setHost(seatId: string | null): void {
    if (this.hostSeatRef !== seatId && this.hostSeatRef !== null) this.lastHostSeatRef = this.hostSeatRef;
    if (seatId === null) {
      this.hostSeatRef = null;
      return;
    }
    const seat = this.seat(seatId);
    if (!seat) return;
    for (const s of this.seatsRef) if (s.role === 'host') s.role = 'player';
    seat.role = 'host';
    this.hostSeatRef = seatId;
  }

  isHost(seatId: string | null | undefined): boolean {
    return seatId != null && seatId === this.hostSeatRef;
  }

  pushChat(entry: ChatEntry): void {
    this.chatRef.push(entry);
    if (this.chatRef.length > CHAT_HISTORY) this.chatRef.splice(0, this.chatRef.length - CHAT_HISTORY);
    // 聊天也是可见状态：不推进 revision 的话，按版本号去重的客户端会把它当重复帧丢掉。
    this.bump();
  }

  systemLine(text: string): ChatEntry {
    const entry: ChatEntry = { seatId: 'system', name: '系统', text, at: this.now(), kind: 'system' };
    this.pushChat(entry);
    return entry;
  }

  seatView(seatId: string): SeatView | null {
    const seat = this.seat(seatId);
    if (!seat) return null;
    return {
      seatId: seat.seatId,
      slot: seat.slot,
      name: seat.name,
      role: seat.role,
      ready: seat.ready,
      connected: seat.connected,
      ageMs: seat.connected ? 0 : seat.disconnectedAt === null ? null : Math.max(0, this.now() - seat.disconnectedAt),
      team: seat.team,
      isHost: seat.seatId === this.hostSeatRef,
    };
  }

  seatsView(): SeatView[] {
    return [...this.seatsRef]
      .sort((a, b) => a.slot - b.slot)
      .map((s) => ({
        seatId: s.seatId,
        slot: s.slot,
        name: s.name,
        role: s.role,
        ready: s.ready,
        connected: s.connected,
        ageMs: s.connected ? 0 : s.disconnectedAt === null ? null : Math.max(0, this.now() - s.disconnectedAt),
        team: s.team,
        isHost: s.seatId === this.hostSeatRef,
      }));
  }

  gameSeat(seatId: string): GameSeatInfo | undefined {
    const seat = this.seat(seatId);
    if (!seat) return undefined;
    return {
      seatId: seat.seatId,
      slot: seat.slot,
      name: seat.name,
      role: seat.role,
      team: seat.team,
      ready: seat.ready,
      connected: seat.connected,
    };
  }

  gameSeats(): GameSeatInfo[] {
    return this.seatsRef.map((s) => ({
      seatId: s.seatId,
      slot: s.slot,
      name: s.name,
      role: s.role,
      team: s.team,
      ready: s.ready,
      connected: s.connected,
    }));
  }

  roomView(): RoomView {
    const host = this.hostSeatRef ? this.seat(this.hostSeatRef) : undefined;
    return {
      code: this.code,
      name: this.name,
      gameId: this.gameId,
      gameName: this.gameName,
      hostSeatId: this.hostSeatRef,
      hostName: host?.name ?? null,
      phase: this.phase,
      seatSlots: this.seatSlots,
      occupied: this.occupied(),
      allowSpectate: this.allowSpectate,
      hasPassword: this.secretHash !== null,
      rulesHash: this.rulesHash,
      config: { ...this.config },
      createdAt: this.createdAt,
    };
  }

  /** 只有房主机器会走到这里；玩家端不写盘，权威状态只有一份。 */
  exportState(): RoomExport {
    return {
      code: this.code,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      phase: this.phase,
      revision: this.revision,
      name: this.name,
      hostSeatId: this.hostSeatRef,
      lastHostSeatId: this.lastHostSeatRef,
      secretHash: this.secretRef,
      seatSlots: this.seatSlots,
      hidden: this.hidden,
      allowSpectate: this.allowSpectate,
      seats: this.seatsRef.map((s) => ({ ...s, transport: null })),
      chat: [...this.chatRef],
    };
  }

  /** 恢复回来的座位一律是"离线待重连"，票据摘要保留，所以朋友重开客户端还能回座。 */
  restoreState(data: RoomExport): void {
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
    this.phase = data.phase;
    this.revision = data.revision;
    this.name = data.name;
    this.secretRef = data.secretHash ?? null;
    this.seatsRef.length = 0;
    for (const seat of data.seats) {
      this.seatsRef.push({
        ...seat,
        connected: false,
        transport: null,
        disconnectedAt: data.updatedAt,
      });
    }
    this.hostSeatRef = data.hostSeatId;
    this.lastHostSeatRef = data.lastHostSeatId ?? null;
    this.chatRef = [...(data.chat ?? [])].slice(-CHAT_HISTORY);
  }
}
