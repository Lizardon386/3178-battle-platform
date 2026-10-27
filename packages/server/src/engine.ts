import type { ClientMessage, ServerMessage } from '@bp/protocol';
import { checkHandshake, isHostCommand } from '@bp/protocol';
import { canBegin, canJoinAs, requireHost, requirePlayerSeat, requireSeat, requireTicket } from './authority.js';
import { newConnId } from './ids.js';
import { manifestOf, isReject, type Effect, type GameAsset, type GameContext, type GameManifest, type GameModule, type GameSeatInfo } from './module-api.js';
import type { SeatRecord, TransportHandle } from './room.js';
import { Room } from './room.js';
import { RoomRegistry } from './registry.js';
import { STORE_VERSION, HostStore, type RestoreReport, type StoredRoom } from './store.js';

export interface TtlConfig {
  /** lobby 房全员离开后多久删。 */
  lobbyIdleMs: number;
  /** 对局中掉线座位的宽限时长。 */
  disconnectGraceMs: number;
  /** ended 房保留多久，够看完结算表。 */
  endedMs: number;
  /** 无任何活动的房。 */
  roomIdleMs: number;
}

export const DEFAULT_TTL: TtlConfig = {
  lobbyIdleMs: 5 * 60_000,
  disconnectGraceMs: 30 * 60_000,
  endedMs: 10 * 60_000,
  roomIdleMs: 30 * 60_000,
};

export interface EngineOptions {
  modules: Iterable<GameModule>;
  /** 单文件包的游戏 id → 文件清单；目录游戏没有。 */
  assets?: ReadonlyMap<string, readonly GameAsset[]>;
  now?: () => number;
  random?: () => number;
  ttl?: Partial<TtlConfig>;
  ratePerSec?: number;
  burst?: number;
  /**
   * 即将给某个座位下发票据时调用（宿主壳用它立刻落盘）。
   * 要守的不变式只有一句：**票据离开进程之前，存着它摘要的那个座位必须已经在盘上**。
   * 否则"刚加入不到一个同步周期就被硬杀"会让恢复后的房里没有这个座位，
   * 玩家拿真票据重连只能得到 NOSEAT（房还在、座位没了），比 NOROOM 更难解释。
   */
  onTicketIssued?: (code: string) => void;
}

/** 出站目标在创建时就解析成具体连接，避免"先清了会话再投递"把通知丢掉。 */
export type Target = { kind: 'conn'; connId: string } | { kind: 'conns'; connIds: string[] };

export interface Outbound {
  target: Target;
  message: ServerMessage;
}

interface Conn {
  id: string;
  transport: TransportHandle;
  code: string | null;
  seatId: string | null;
  nick: string;
  helloDone: boolean;
  declared: { version?: string; rulesHash?: string } | null;
  tokens: number;
  lastRefill: number;
  strikes: number;
}

/** 入座前放行的消息类型；其余一律要求已有座位。 */
const PRE_SEAT_TYPES: ReadonlySet<string> = new Set([
  'hello',
  'roomCreate',
  'roomJoin',
  'seatResume',
  'resync',
  'ping',
]);

/**
 * 引擎把线消息翻译成对房间与游戏实例的操作，再把结果编排成出站消息。
 * 传输层（ws）与契约测试驱动的是同一个引擎，所以证明"平台与玩法无关"不需要真 socket。
 */
export class Engine {
  readonly registry: RoomRegistry;
  private readonly modules = new Map<string, GameModule>();
  private readonly assetsByGame: ReadonlyMap<string, readonly GameAsset[]>;
  private readonly defaultManifests = new Map<string, GameManifest>();
  private readonly conns = new Map<string, Conn>();
  private readonly clock: () => number;
  private readonly rng: () => number;
  private readonly ttl: TtlConfig;
  private readonly ratePerSec: number;
  private readonly burst: number;
  /** 见 EngineOptions.onTicketIssued。公开是为了让宿主壳在 store 建好之后再挂上。 */
  onTicketIssued: ((code: string) => void) | null;
  /** 上次落盘的内容原文。用来跳过没变的房——这样同步可以很勤，而不会把磁盘写爆。 */
  private readonly lastSynced = new Map<string, string>();

  constructor(opts: EngineOptions) {
    this.clock = opts.now ?? (() => Date.now());
    this.rng = opts.random ?? Math.random;
    this.ttl = { ...DEFAULT_TTL, ...opts.ttl };
    this.ratePerSec = opts.ratePerSec ?? 20;
    this.onTicketIssued = opts.onTicketIssued ?? null;
    this.burst = opts.burst ?? 40;
    this.registry = new RoomRegistry(this.clock);
    this.assetsByGame = opts.assets ?? new Map();
    for (const module of opts.modules) {
      this.modules.set(module.id, module);
      this.defaultManifests.set(module.id, manifestOf(module, module.normalizeConfig({}), this.assetsByGame.get(module.id)));
    }
  }

  openConn(transport: TransportHandle): string {
    const id = newConnId();
    this.conns.set(id, {
      id,
      transport,
      code: null,
      seatId: null,
      nick: '',
      helloDone: false,
      declared: null,
      tokens: this.burst,
      lastRefill: this.clock(),
      strikes: 0,
    });
    return id;
  }

  closeConn(connId: string): Outbound[] {
    const conn = this.conns.get(connId);
    this.conns.delete(connId);
    if (!conn?.code || !conn.seatId) return [];
    const room = this.registry.get(conn.code);
    if (!room) return [];
    const seatId = conn.seatId;
    conn.seatId = null;
    conn.code = null;
    const seat = room.seat(seatId);
    if (!seat) return [];
    if (!room.detach(seatId, conn.transport)) return [];
    // 旧语义保留：lobby 里最后一人走会立刻删房；对局中则保留座位等重连。
    if (room.phase === 'lobby' && !room.hasHumanConnected()) {
      room.game?.dispose?.();
      this.registry.remove(room.code);
      return [];
    }
    return this.fanout(room);
  }

  /**
   * 房主进程退出/崩溃：广播"主机已退出"并删局。
   * 这里自己投递，因为投完就要清连接表——留给调用方 publish 会把通知丢掉。
   */
  shutdown(): void {
    for (const room of this.registry.list(true)) {
      if (room.phase === 'playing') {
        this.publish([this.toRoom(room, { type: 'notice', code: 'HOSTLEFT', text: '主机已退出，本局结束' })]);
      }
      room.game?.dispose?.();
      this.registry.remove(room.code);
    }
    for (const conn of this.conns.values()) conn.transport.close?.(1001, 'host exiting');
    this.conns.clear();
  }

  tick(): Outbound[] {
    const out: Outbound[] = [];
    const now = this.clock();
    for (const room of [...this.registry.list(true)]) {
      if (this.sweepRoom(room, now)) continue;
      out.push(...this.pumpGame(room));
      out.push(...this.ejectExpired(room, now));
    }
    return out;
  }

  /** 房主侧要落盘的房（ended 的不留，结算看完就该散）。 */
  persistable(): StoredRoom[] {
    const out: StoredRoom[] = [];
    for (const room of this.registry.list(true)) {
      if (room.phase === 'ended') continue;
      out.push({
        v: STORE_VERSION,
        gameId: room.gameId,
        gameVersion: room.manifest.version,
        rulesHash: room.rulesHash,
        config: room.config,
        room: room.exportState(),
        game: room.game ? room.game.snapshot() : null,
      });
    }
    return out;
  }

  /**
   * 显式同步，而不是在每个变更点偷偷写盘：hostd 定时调 + 退出前调一次。
   * 内容没变的房直接跳过，所以"定时"可以做到很勤（跟着心跳 250ms）——
   * 否则刚建房就被硬杀（用户直接点控制台窗口的 X 就是 TerminateProcess，不走收尾）
   * 会丢掉最多一个同步周期的房，而朋友手里已经拿到了邀请链接。
   */
  syncStore(store: HostStore): { saved: number; removed: string[] } {
    const alive = new Set<string>();
    let saved = 0;
    for (const entry of this.persistable()) {
      const code = entry.room.code;
      alive.add(code);
      const raw = JSON.stringify(entry);
      if (this.lastSynced.get(code) === raw) continue;
      if (store.writeFile(code, raw)) {
        this.lastSynced.set(code, raw);
        saved += 1;
      }
    }
    const removed: string[] = [];
    for (const entry of store.readAll().entries) {
      if (alive.has(entry.room.code)) continue;
      store.remove(entry.room.code);
      this.lastSynced.delete(entry.room.code);
      removed.push(entry.room.code);
    }
    for (const code of [...this.lastSynced.keys()]) {
      if (!alive.has(code)) this.lastSynced.delete(code);
    }
    return { saved, removed };
  }

  /**
   * 启动时恢复房主侧快照。版本/房规不符的记录一律丢弃而不是硬开，
   * 这是旧项目 deckVersion 闸的泛化位置。
   */
  restoreFrom(entries: StoredRoom[]): RestoreReport {
    const report: RestoreReport = { restored: [], dropped: [] };
    for (const entry of entries) {
      const code = entry.room?.code ?? '?';
      const module = this.modules.get(entry.gameId);
      if (!module) {
        report.dropped.push({ code, reason: 'UNKNOWN_GAME' });
        continue;
      }
      if (entry.gameVersion !== module.version) {
        report.dropped.push({ code, reason: 'VERSION' });
        continue;
      }
      const config = module.normalizeConfig(entry.config);
      if (module.rulesHashOf(config) !== entry.rulesHash) {
        report.dropped.push({ code, reason: 'RULES' });
        continue;
      }
      if (entry.game !== null && entry.game !== undefined && module.acceptsSnapshot?.(entry.game) === false) {
        report.dropped.push({ code, reason: 'SNAPSHOT' });
        continue;
      }
      const room = this.registry.create({
        code,
        name: entry.room.name,
        module,
        assets: this.assetsByGame.get(module.id),
        rawConfig: entry.config,
        seatSlots: entry.room.seatSlots,
        password: null,
        hidden: entry.room.hidden,
        allowSpectate: entry.room.allowSpectate,
      });
      room.restoreState(entry.room);
      if (entry.game !== null && entry.game !== undefined) {
        try {
          room.setGame(module.resume(entry.game, this.contextFor(room)));
        } catch {
          this.registry.remove(code);
          report.dropped.push({ code, reason: 'SNAPSHOT' });
          continue;
        }
      }
      report.restored.push(code);
    }
    return report;
  }

  dispatch(connId: string, msg: ClientMessage): Outbound[] {
    const conn = this.conns.get(connId);
    if (!conn) return [];
    if (!this.allowRate(conn)) {
      return [this.to(conn.id, { type: 'error', code: 'RATE', message: '操作太快，稍等一下' })];
    }
    if (msg.type === 'hello') return this.onHello(conn, msg);
    if (!conn.helloDone) {
      return [this.to(conn.id, { type: 'error', code: 'PROTOCOL', message: '连接后第一条必须是 hello' })];
    }
    if (!conn.seatId && !PRE_SEAT_TYPES.has(msg.type)) {
      return [this.to(conn.id, { type: 'error', code: 'NOSEAT', message: '你还没有座位' })];
    }
    if (isHostCommand(msg.type)) return this.onHostCommand(conn, msg);
    switch (msg.type) {
      case 'roomCreate':
        return this.onCreate(conn, msg);
      case 'roomJoin':
        return this.onJoin(conn, msg);
      case 'seatResume':
        return this.onResume(conn, msg);
      case 'ready':
        return this.onReady(conn, msg.ready);
      case 'gameAction':
        return this.onAction(conn, msg.name, msg.payload);
      case 'chat':
        return this.onChat(conn, msg.text);
      case 'seatLeave':
        return this.onLeave(conn);
      case 'resync':
        return this.onResync(conn, msg.since);
      case 'ping':
        return [this.to(conn.id, { type: 'pong', nonce: msg.nonce, serverNow: this.clock() })];
      default:
        return [this.to(conn.id, { type: 'error', code: 'BADMSG', message: '未知消息' })];
    }
  }

  // ---------------- 内部：连接与房间 ----------------

  private to(connId: string, message: ServerMessage): Outbound {
    return { target: { kind: 'conn', connId }, message };
  }

  private toSeat(room: Room, seatId: string, message: ServerMessage): Outbound {
    return { target: { kind: 'conns', connIds: this.connIdsOf(room, seatId) }, message };
  }

  private toRoom(room: Room, message: ServerMessage): Outbound {
    return { target: { kind: 'conns', connIds: this.connIdsOf(room, null) }, message };
  }

  private connIdsOf(room: Room, seatId: string | null): string[] {
    const out: string[] = [];
    for (const conn of this.conns.values()) {
      if (conn.code !== room.code || !conn.seatId) continue;
      if (seatId !== null && conn.seatId !== seatId) continue;
      out.push(conn.id);
    }
    return out;
  }

  private roomOf(conn: Conn): Room | undefined {
    return conn.code ? this.registry.get(conn.code) : undefined;
  }

  private allowRate(conn: Conn): boolean {
    const now = this.clock();
    conn.tokens = Math.min(this.burst, conn.tokens + ((now - conn.lastRefill) / 1000) * this.ratePerSec);
    conn.lastRefill = now;
    if (conn.tokens < 1) {
      conn.strikes += 1;
      if (conn.strikes >= 10) conn.transport.close?.(1008, 'rate limited');
      return false;
    }
    conn.tokens -= 1;
    conn.strikes = 0;
    return true;
  }

  private onHello(conn: Conn, msg: Extract<ClientMessage, { type: 'hello' }>): Outbound[] {
    conn.helloDone = true;
    conn.nick = msg.nick;
    // 客户端没声明游戏就不做版本闸（它可能只是来逛列表的）。
    conn.declared = msg.gameId ? { version: msg.version, rulesHash: msg.rulesHash } : null;
    return [
      this.to(conn.id, {
        type: 'welcome',
        protocol: 1,
        serverNow: this.clock(),
        availableGames: [...this.defaultManifests.values()],
      }),
    ];
  }

  /**
   * 版本闸放在入房前（war3 的地图校验就是这个位置）：
   * 客户端 hello 声明了自己装的游戏版本，与房主不一致就不让进，别等开局了才发现。
   */
  private versionGate(conn: Conn, room: Room): ServerMessage | null {
    if (!conn.declared) return null;
    const check = checkHandshake({ version: room.manifest.version, rulesHash: room.rulesHash }, conn.declared);
    if (check.ok) return null;
    return { type: 'error', code: check.code, message: check.message };
  }

  private onCreate(conn: Conn, msg: Extract<ClientMessage, { type: 'roomCreate' }>): Outbound[] {
    if (conn.seatId) {
      return [this.to(conn.id, { type: 'error', code: 'PHASE', message: '你已经在一个房里了' })];
    }
    const module = this.modules.get(msg.gameId);
    if (!module) {
      return [this.to(conn.id, { type: 'error', code: 'UNKNOWN_GAME', message: `房主机上没有这个游戏：${msg.gameId}` })];
    }
    const room = this.registry.create({
      name: msg.roomName,
      module,
      assets: this.assetsByGame.get(module.id),
      rawConfig: msg.config,
      seatSlots: msg.seatSlots,
      password: msg.password ?? null,
      hidden: msg.hidden ?? false,
      allowSpectate: msg.allowSpectate ?? true,
    });
    const added = room.addSeat({ name: conn.nick, role: 'host', transport: conn.transport, slot: 1 });
    if (!added.ok) {
      this.registry.remove(room.code);
      return [this.to(conn.id, { type: 'error', code: 'INTERNAL', message: '建房失败：座位分配异常' })];
    }
    conn.code = room.code;
    conn.seatId = added.seat.seatId;
    room.systemLine(`${conn.nick} 创建了房间，等待玩家入座`);
    return [
      this.granted(room, added.seat, added.ticket),
      ...this.fanout(room),
    ];
  }

  private granted(room: Room, seat: SeatRecord, ticket: string): Outbound {
    // 先落盘再发票据：见 EngineOptions.onTicketIssued 的注释
    this.onTicketIssued?.(room.code);
    return this.toSeat(room, seat.seatId, {
      type: 'seatGranted',
      code: room.code,
      seatId: seat.seatId,
      ticket,
      role: seat.role,
      slot: seat.slot,
      hostSeatId: room.hostSeatId,
      serverNow: this.clock(),
      manifest: room.manifest,
    });
  }

  private onJoin(conn: Conn, msg: Extract<ClientMessage, { type: 'roomJoin' }>): Outbound[] {
    if (conn.seatId) return [this.to(conn.id, { type: 'error', code: 'PHASE', message: '你已经在一个房里了' })];
    const room = this.registry.get(msg.code);
    if (!room) return [this.to(conn.id, { type: 'error', code: 'NOROOM', message: '房间不存在或已结束' })];
    const gate = this.versionGate(conn, room);
    if (gate) return [this.to(conn.id, gate)];
    const wanted = msg.as === 'spectator' ? 'spectator' : 'player';
    const allow = canJoinAs(room, wanted, msg.password);
    if (!allow.ok) {
      return [this.to(conn.id, { type: 'error', code: allow.code ?? 'PHASE', message: allow.message ?? '进不去' })];
    }
    const added = room.addSeat({ name: conn.nick, role: wanted, transport: conn.transport, slot: msg.slot });
    if (!added.ok) return [this.to(conn.id, { type: 'error', code: 'FULL', message: '房间已满' })];
    conn.code = room.code;
    conn.seatId = added.seat.seatId;
    const joined = room.systemLine(`${conn.nick} 进入房间`);
    return [
      this.granted(room, added.seat, added.ticket),
      this.toRoom(room, { type: 'chat', ...joined }),
      ...this.pumpJoin(room, added.seat.seatId),
      ...this.fanout(room),
    ];
  }

  private onResume(conn: Conn, msg: Extract<ClientMessage, { type: 'seatResume' }>): Outbound[] {
    const room = this.registry.get(msg.code);
    if (!room) return [this.to(conn.id, { type: 'error', code: 'NOROOM', message: '房间不存在或已结束' })];
    const gate = this.versionGate(conn, room);
    if (gate) return [this.to(conn.id, gate)];
    const auth = requireTicket(room, msg.seatId, msg.ticket);
    if (!auth.ok) return [this.to(conn.id, { type: 'error', code: auth.code, message: auth.message })];
    const previousTransport = auth.seat.transport;
    if (previousTransport && previousTransport !== conn.transport) {
      const old = this.connOfTransport(previousTransport);
      previousTransport.close?.(1008, 'seat taken over');
      if (old) {
        old.seatId = null;
        old.code = null;
        this.conns.delete(old.id);
      }
      this.deliver(auth.seat, { type: 'notice', code: 'REJOINED', text: '同一票据在新设备接上了这个座位' });
    }
    room.attach(msg.seatId, conn.transport);
    conn.code = room.code;
    conn.seatId = msg.seatId;
    return [this.granted(room, auth.seat, msg.ticket), ...this.fanout(room)];
  }

  // ---------------- 内部：房主命令 ----------------

  private onHostCommand(conn: Conn, msg: ClientMessage): Outbound[] {
    const room = this.roomOf(conn);
    if (!room) return [this.to(conn.id, { type: 'error', code: 'NOROOM', message: '房间不存在' })];
    const auth = requireHost(room, conn.seatId);
    if (!auth.ok) return [this.toSeat(room, conn.seatId ?? '', { type: 'error', code: auth.code, message: auth.message })];
    switch (msg.type) {
      case 'hostStart':
        return this.onStart(room);
      case 'hostClose':
        return this.onCloseRoom(room, msg.reason);
      case 'hostKick':
        return this.kick(room, msg.seatId, '房主把你请出了座位');
      case 'hostTransfer':
        return this.transfer(room, msg.seatId);
      case 'hostSeat':
        return this.seatOp(room, msg);
      default:
        return [];
    }
  }

  private onStart(room: Room): Outbound[] {
    const hostSeatId = room.hostSeatId ?? '';
    const gate = canBegin(room);
    if (!gate.ok) {
      return [this.toSeat(room, hostSeatId, { type: 'error', code: gate.code ?? 'PHASE', message: gate.message ?? '开不了局' })];
    }
    room.game?.dispose?.();
    const instance = room.module.create(room.config, this.contextFor(room));
    const begun = instance.begin();
    if (isReject(begun)) {
      instance.dispose?.();
      return [this.toSeat(room, hostSeatId, { type: 'error', code: begun.code ?? 'PHASE', message: begun.reject })];
    }
    room.setGame(instance);
    room.phase = 'playing';
    room.bump();
    const out = this.applyEffects(room, begun);
    const line = room.systemLine('对局开始');
    out.push(this.toRoom(room, { type: 'chat', ...line }));
    out.push(...this.fanout(room));
    return out;
  }

  private onCloseRoom(room: Room, reason?: string): Outbound[] {
    room.phase = 'ended';
    room.bump();
    room.game?.dispose?.();
    room.setGame(null);
    const out = [
      this.toRoom(room, {
        type: 'notice',
        code: 'ROOM_CLOSED',
        text: reason ? `房主关闭了房间：${reason}` : '房主关闭了房间',
      }),
    ];
    for (const conn of this.conns.values()) {
      if (conn.code === room.code) {
        conn.code = null;
        conn.seatId = null;
      }
    }
    this.registry.remove(room.code);
    return out;
  }

  /** 移交只转移权限，进程仍在原房主机上——别把它当容灾。 */
  private transfer(room: Room, seatId: string): Outbound[] {
    const target = requirePlayerSeat(room, seatId);
    if (!target.ok) {
      return [this.toSeat(room, room.hostSeatId ?? '', { type: 'error', code: target.code, message: target.message })];
    }
    room.setHost(seatId);
    room.bump();
    return [
      this.toRoom(room, { type: 'notice', code: 'HOST_CHANGED', text: `房主已移交给 ${target.seat.name}` }),
      ...this.fanout(room),
    ];
  }

  private seatOp(room: Room, msg: Extract<ClientMessage, { type: 'hostSeat' }>): Outbound[] {
    if (msg.op === 'addAi') {
      const added = room.addSeat({ name: String(msg.seatId ?? `电脑 ${room.occupied()}`), role: 'ai', isAi: true });
      if (!added.ok) {
        return [this.toSeat(room, room.hostSeatId ?? '', { type: 'error', code: 'FULL', message: '加不了电脑位（槽满或该游戏不支持填充）' })];
      }
      room.bump();
      const joined = room.systemLine(`房主加了电脑 ${added.seat.name}`);
      return [
        this.toRoom(room, { type: 'chat', ...joined }),
        ...this.pumpJoin(room, added.seat.seatId),
        ...this.fanout(room),
      ];
    }
    if (msg.op === 'removeAi') {
      const seat = room.seat(msg.seatId ?? '');
      if (!seat?.isAi) return [];
      const left = this.gameInfo(room, seat) ?? this.asInfo(seat);
      room.removeSeat(seat.seatId);
      room.bump();
      return [...this.pumpLeave(room, left), ...this.fanout(room)];
    }
    const seat = room.seat(msg.seatId ?? '');
    if (!seat) return [];
    if (msg.op === 'setTeam' && msg.team !== undefined) seat.team = msg.team;
    if (msg.op === 'move' && typeof msg.slot === 'number' && !room.seatBySlot(msg.slot) && seat.role !== 'spectator') {
      seat.slot = msg.slot;
    }
    room.bump();
    return this.fanout(room);
  }

  // ---------------- 内部：座位与玩法 ----------------

  private onReady(conn: Conn, ready: boolean): Outbound[] {
    const room = this.roomOf(conn);
    if (!room) return [];
    const auth = requirePlayerSeat(room, conn.seatId);
    if (!auth.ok) return [this.toSeat(room, conn.seatId ?? '', { type: 'error', code: auth.code, message: auth.message })];
    auth.seat.ready = ready;
    room.bump();
    return this.fanout(room);
  }

  private onAction(conn: Conn, name: string, payload: unknown): Outbound[] {
    const room = this.roomOf(conn);
    if (!room) return [this.to(conn.id, { type: 'error', code: 'NOROOM', message: '房间不存在' })];
    const auth = requirePlayerSeat(room, conn.seatId);
    if (!auth.ok) return [this.toSeat(room, conn.seatId ?? '', { type: 'error', code: auth.code, message: auth.message })];
    if (room.phase !== 'playing' || !room.game) {
      return [this.toSeat(room, auth.seat.seatId, { type: 'error', code: 'PHASE', message: '对局还没开始' })];
    }
    const result = room.game.handle({ name, payload }, auth.seat.seatId);
    if (isReject(result)) {
      return [this.toSeat(room, auth.seat.seatId, { type: 'error', code: result.code ?? 'PHASE', message: result.reject })];
    }
    room.bump();
    const out = this.applyEffects(room, result);
    out.push(...this.fanout(room));
    return out;
  }

  private onChat(conn: Conn, text: string): Outbound[] {
    const room = this.roomOf(conn);
    if (!room) return [this.to(conn.id, { type: 'error', code: 'NOROOM', message: '不在房间里' })];
    const auth = requireSeat(room, conn.seatId);
    if (!auth.ok) return [this.to(conn.id, { type: 'error', code: auth.code, message: auth.message })];
    const entry = { seatId: auth.seat.seatId, name: auth.seat.name, text, at: this.clock(), kind: 'say' as const };
    room.pushChat(entry);
    return [this.toRoom(room, { type: 'chat', ...entry })];
  }

  private onLeave(conn: Conn): Outbound[] {
    const room = this.roomOf(conn);
    if (!room || !conn.seatId) return [];
    if (room.isHost(conn.seatId)) {
      // 房主离席必须先表态：移交还是关局。平台不替他选，也不许"顺手就走"。
      return [
        this.toSeat(room, conn.seatId, {
          type: 'error',
          code: 'PHASE',
          message: '房主要离开请先移交房主或关闭房间',
        }),
      ];
    }
    const seat = room.seat(conn.seatId);
    if (!seat) return [];
    const info = this.gameInfo(room, seat) ?? this.asInfo(seat);
    room.removeSeat(seat.seatId);
    conn.seatId = null;
    conn.code = null;
    const out = this.pumpLeave(room, info);
    const left = room.systemLine(`${seat.name} 离开了房间`);
    out.push(this.toRoom(room, { type: 'chat', ...left }));
    if (room.phase === 'lobby' && !room.hasHumanConnected()) {
      this.registry.remove(room.code);
      return out;
    }
    out.push(...this.fanout(room));
    return out;
  }

  private onResync(conn: Conn, since: number): Outbound[] {
    const room = this.roomOf(conn);
    if (!room || !conn.seatId) return [];
    if (since === room.revision) return [];
    return [this.toSeat(room, conn.seatId, this.snapshotFor(room, room.seat(conn.seatId) ?? null))];
  }

  private kick(room: Room, seatId: string, reason: string): Outbound[] {
    const seat = room.seat(seatId);
    if (!seat) return [];
    if (room.isHost(seatId)) return [];
    const info = this.gameInfo(room, seat) ?? this.asInfo(seat);
    room.removeSeat(seatId);
    room.bump();
    const out = this.pumpLeave(room, info);
    if (seat.transport) {
      this.deliver(seat, { type: 'notice', code: 'SEAT_EJECTED', text: reason });
      seat.transport.close?.(1008, reason);
      const conn = this.connOfTransport(seat.transport);
      if (conn) {
        conn.seatId = null;
        conn.code = null;
      }
    }
    const line = room.systemLine(`${seat.name} ${reason}`);
    out.push(this.toRoom(room, { type: 'chat', ...line }));
    out.push(...this.fanout(room));
    return out;
  }

  // ---------------- 内部：心跳与终局语义 ----------------

  private sweepRoom(room: Room, now: number): boolean {
    const idle = now - room.updatedAt;
    const drop =
      (room.phase === 'ended' && idle > this.ttl.endedMs) ||
      (room.phase === 'lobby' && !room.hasHumanConnected() && idle > this.ttl.lobbyIdleMs) ||
      idle > this.ttl.roomIdleMs;
    if (!drop) return false;
    for (const conn of this.conns.values()) {
      if (conn.code === room.code) {
        conn.code = null;
        conn.seatId = null;
      }
    }
    room.game?.dispose?.();
    this.registry.remove(room.code);
    return true;
  }

  private pumpGame(room: Room): Outbound[] {
    if (room.phase !== 'playing' || !room.game?.tick) return [];
    const effects = room.game.tick(this.clock());
    if (effects.length === 0) return [];
    room.bump();
    const out = this.applyEffects(room, effects);
    out.push(...this.fanout(room));
    return out;
  }

  private ejectExpired(room: Room, now: number): Outbound[] {
    if (room.phase !== 'playing') return [];
    const out: Outbound[] = [];
    let changed = false;
    for (const seat of [...room.seats]) {
      if (seat.connected || seat.isAi || seat.disconnectedAt === null) continue;
      if (now - seat.disconnectedAt < this.ttl.disconnectGraceMs) continue;
      if (room.isHost(seat.seatId)) {
        room.phase = 'ended';
        room.bump();
        out.push(this.toRoom(room, { type: 'notice', code: 'HOSTLEFT', text: '房主掉线过久，本局结束' }));
        this.registry.remove(room.code);
        return out;
      }
      const info = this.gameInfo(room, seat) ?? this.asInfo(seat);
      if (room.game?.onTimeout) out.push(...this.applyEffects(room, room.game.onTimeout(info)));
      out.push(...this.kick(room, seat.seatId, '掉线过久，座位已收回'));
      changed = true;
    }
    if (room.phase === 'playing' && room.game && room.occupied() < room.module.seats.min) {
      room.phase = 'ended';
      room.bump();
      out.push(this.toRoom(room, { type: 'notice', code: 'TOO_FEW', text: '在线人数不足，本局结束' }));
      changed = true;
    }
    if (changed) out.push(...this.fanout(room));
    return out;
  }

  private pumpLeave(room: Room, info: GameSeatInfo): Outbound[] {
    if (!room.game?.onSeatLeave) return [];
    return this.applyEffects(room, room.game.onSeatLeave(info, room.phase));
  }

  private pumpJoin(room: Room, seatId: string): Outbound[] {
    const game = room.game;
    if (!game?.onSeatJoin) return [];
    const info = room.gameSeat(seatId);
    if (!info) return [];
    return this.applyEffects(room, game.onSeatJoin(info));
  }

  private applyEffects(room: Room, effects: Effect[]): Outbound[] {
    const out: Outbound[] = [];
    for (const effect of effects) {
      switch (effect.kind) {
        case 'broadcast':
          out.push(this.toRoom(room, { type: 'event', name: effect.name, payload: effect.payload }));
          break;
        case 'toSeat':
          if (room.seat(effect.seatId)) out.push(this.toSeat(room, effect.seatId, { type: 'event', name: effect.name, payload: effect.payload }));
          break;
        case 'notice':
          out.push(this.toRoom(room, { type: 'notice', code: effect.code, text: effect.text }));
          break;
        case 'system': {
          const entry = room.systemLine(effect.text);
          out.push(this.toRoom(room, { type: 'chat', ...entry }));
          break;
        }
        case 'end':
          room.phase = 'ended';
          room.bump();
          out.push(this.toRoom(room, { type: 'notice', code: 'HOSTLEFT', text: effect.reason ?? '对局结束' }));
          break;
        case 'kick':
          out.push(...this.kick(room, effect.seatId, effect.reason ?? '你被请出座位'));
          break;
      }
    }
    return out;
  }

  // ---------------- 内部：快照 ----------------

  private gameInfo(room: Room, seat: SeatRecord | undefined | null): GameSeatInfo | undefined {
    return seat ? room.gameSeat(seat.seatId) : undefined;
  }

  private asInfo(seat: SeatRecord): GameSeatInfo {
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

  private contextFor(room: Room): GameContext {
    return {
      roomCode: room.code,
      config: room.config,
      now: () => this.clock(),
      random: () => this.rng(),
      seats: () => room.gameSeats(),
      seat: (seatId: string) => room.gameSeat(seatId),
    };
  }

  private snapshotFor(room: Room, seat: SeatRecord | null): ServerMessage {
    const viewer = seat === null || seat.role === 'spectator' ? null : seat.seatId;
    return {
      type: 'snapshot',
      revision: room.revision,
      serverNow: this.clock(),
      room: room.roomView(),
      seats: room.seatsView(),
      phase: room.phase,
      game: room.game ? room.game.serialize(viewer) : null,
    };
  }

  /** 每个座位拿自己视角的快照；观战拿公开视角。 */
  private fanout(room: Room): Outbound[] {
    const out: Outbound[] = [];
    for (const seat of room.seats) {
      if (!seat.transport) continue;
      out.push(this.toSeat(room, seat.seatId, this.snapshotFor(room, seat)));
    }
    return out;
  }

  private connOfTransport(transport: TransportHandle): Conn | undefined {
    for (const conn of this.conns.values()) if (conn.transport === transport) return conn;
    return undefined;
  }

  private deliver(seat: SeatRecord, message: ServerMessage): void {
    seat.transport?.send(JSON.stringify(message));
  }

  /** 把出站编排投递到连接。传输层拿到 dispatch 的返回值后调用它。 */
  publish(items: Iterable<Outbound>): void {
    for (const item of items) {
      const connIds = item.target.kind === 'conn' ? [item.target.connId] : item.target.connIds;
      for (const connId of connIds) {
        this.conns.get(connId)?.transport.send(JSON.stringify(item.message));
      }
    }
  }
}
