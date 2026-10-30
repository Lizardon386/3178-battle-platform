import type { ClientMessage, ServerMessage } from '@bp/protocol';
import type { GameManifest, SeatOptionField, SeatView } from '@lizardon386/core-abi';
import { NOTICE_MESSAGES } from '@bp/protocol';
import { PlatformConnection, browserSocketFactory, type ConnectionHandlers, type ConnectionOptions, type SocketFactory, type Timers, type ConnectionState } from './connection.js';
import { AddressBook, NickName, SessionVault, type KeyValueStore, type SessionRecord } from './local-store.js';
import { ServerClock } from './clock.js';
import { parseHostAddress, parseInviteLink, wouldBeBlocked, type Endpoint } from './endpoint.js';
import { aiFillBlocker, emptyViewModel, inviteLink, accessHints, isHost, mySeat, reduce, resumeCodeFor, seatLabel, seatPickerBlocker, seatPickerCandidates, startBlockers, emptySlots, type ViewModel } from './view-model.js';
import { fetchGameList, loadGameClientSource, placeholderClient, sandboxChatText, sandboxedClient, type FetchImpl, type GameActions, type GameClientContract } from './module-loader.js';
import { ruleConfigFromValues, ruleConfigSpec, ruleConfigSummary } from './rule-config.js';
import { seatOptionFields, seatOptionsSpec } from './seat-options.js';
import { loadGameReference, renderReference, type ReferenceLoad } from './reference.js';
import { SelectListboxes } from './listbox.js';

/**
 * 客户端外壳：大厅 → 房间内（槽位 + 聊天 + 房主面板）→ 对局挂载点。
 * DOM 只在 ui 层出现，状态归约全在 view-model.ts，逻辑可测。
 */

export interface AppDeps {
  doc: Document;
  storage: KeyValueStore;
  factory?: SocketFactory;
  timers?: Timers;
  fetchImpl?: FetchImpl;
  now?: () => number;
  /** 本机壳自己的来源：/api/games、/discovery/rooms 都从这里取。 */
  selfOrigin?: string;
  search?: string;
}

const el = <T extends HTMLElement>(doc: Document, id: string): T | null => doc.getElementById(id) as T | null;
const value = (node: HTMLElement | null): string => (node as HTMLInputElement | null)?.value?.trim() ?? '';
/** 没填名字时的占位称呼。它**不是**一个可被记住的昵称——存进去就等于把"无名玩家"永久钉在本机上。 */
const DEFAULT_NICK = '无名玩家';

export class PlatformApp {
  private readonly doc: Document;
  private readonly book: AddressBook;
  private readonly nick: NickName;
  private readonly vault: SessionVault;
  private readonly clock: ServerClock;
  private readonly fetchImpl: FetchImpl;
  private readonly selfOrigin: string;
  /** 邀请链接该写哪个地址：host 模式由 /api/self 给出局域网/隧道入口。 */
  private inviteOrigin: string;
  /** 本机可告知朋友的局域网入口（多网卡会有多个）。 */
  private lanOrigins: string[] = [];
  private view: ViewModel = emptyViewModel();
  private conn: PlatformConnection | null = null;
  private endpoint: Endpoint | null = null;
  private connState: ConnectionState = { status: 'idle', attempts: 0, lastError: null, wsUrl: null };
  private client: GameClientContract | null = null;
  /** 防止上一次异步拉取/沙箱启动在换房或离开后还往新界面里挂载。 */
  private attachSeq = 0;
  private pendingManifest: GameManifest | null = null;
  private localGames: GameManifest[] = [];
  private renderHandle: unknown = null;
  private deadlineAt: number | null = null;
  private resumeAttempted = false;
  private drawerOpen = false;
  private drawerWasPlaying = false;
  private referenceOpen = false;
  private referenceTrigger: HTMLElement | null = null;
  private referenceSeq = 0;
  private readonly referenceCache = new Map<string, ReferenceLoad>();
  private ruleConfigSignature = '';
  private readonly listboxes: SelectListboxes;

  constructor(private readonly deps: AppDeps) {
    this.doc = deps.doc;
    this.listboxes = new SelectListboxes(deps.doc);
    this.book = new AddressBook(deps.storage);
    this.nick = new NickName(deps.storage);
    this.vault = new SessionVault(deps.storage);
    this.clock = new ServerClock();
    // 不能写 deps.fetchImpl ?? fetch 直接存起来：那样 this.fetchImpl(...) 会把 fetch 的
    // 接收者变成 app，浏览器里直接 Illegal invocation。用箭头包一层保持裸调用。
    const injected = deps.fetchImpl;
    this.fetchImpl = injected ? (input, init) => injected(input, init) : (input, init) => fetch(input, init);
    this.selfOrigin = deps.selfOrigin ?? 'http://127.0.0.1:3178';
    this.inviteOrigin = this.selfOrigin;
  }

  start(): void {
    const search = this.deps.search ?? this.doc.defaultView?.location.search ?? '';
    const invite = search ? parseInviteLink(`${this.selfOrigin}${search}`, this.selfOrigin) : { endpoint: null, code: null, gameId: null };
    this.bindUi();
    const nickField = el(this.doc, 'nick');
    if (nickField) (nickField as HTMLInputElement).value = this.nick.get();
    // 地址簿是同源共享的：另一个标签页"忘掉"一条，本标签页的下拉里还留着那条假的，点下去只能说"不在了"。
    // storage 事件只在**别的**文档写同一 key 时触发（自己写不触发），所以这里不会自己转圈；
    // 不按 key 过滤是因为重建一次下拉本来就这么点成本，多一个魔法字符串反而多一处会过期的耦合。
    this.doc.defaultView?.addEventListener('storage', () => this.renderAddressBook());
    void this.loadSelfInfo();
    void this.refreshLobbySources(invite);
    this.startRenderLoop();
    this.render();
  }

  /** 倒计时要自己走，不然对局里的时间戳会冻在上一帧。 */
  private startRenderLoop(): void {
    const timers = this.deps.timers;
    const set = timers?.setTimeout ?? ((handler: () => void, ms: number) => setTimeout(handler, ms) as unknown);
    set(() => {
      this.render();
      this.startRenderLoop();
    }, 500);
  }

  // ---------------- 连接 ----------------

  private async refreshLobbySources(invite: { endpoint: Endpoint | null; code: string | null; gameId: string | null }): Promise<void> {
    const address = el(this.doc, 'host-address') as HTMLInputElement | null;
    if (invite.endpoint && !address?.value) {
      address!.value = invite.endpoint.httpOrigin;
      const code = el(this.doc, 'room-code') as HTMLInputElement | null;
      if (code && invite.code) code.value = invite.code;
    }
    try {
      const games = await fetchGameList(this.selfOrigin, this.fetchImpl);
      this.localGames = games;
      const select = el(this.doc, 'game-select') as HTMLSelectElement | null;
      if (select && games.length > 0) {
        select.replaceChildren(
          ...games.map((g) => {
            const option = this.doc.createElement('option');
            option.value = g.id;
            option.textContent = `${g.name} ${g.version}`;
            return option;
          }),
        );
        if (invite.gameId) select.value = invite.gameId;
      }
      this.listboxes.syncAll();
    } catch {
      this.setStatus('本机壳没提供游戏清单——创建房间会失败，但加入别人的房不受影响。');
    }
    try {
      const response = await this.fetchImpl(`${this.selfOrigin}/discovery/rooms`, { mode: 'cors' });
      if (response.ok) {
        const data = (await response.json()) as { rooms?: Array<{ code: string; name: string; gameName: string; occupied: number; seatSlots: number; lanUrl: string; hostName: string }> };
        this.renderLanList(data.rooms ?? []);
      }
    } catch (error) {
      // 没装本地壳就没有局域网列表；地址簿 + 邀请链接仍然可用（A 档）。要说清原因，别静默留白。
      const list = el(this.doc, 'lan-list');
      if (list) {
        const note = this.doc.createElement('p');
        note.className = 'lan-empty';
        note.textContent = `拿不到局域网房间列表：${String(error instanceof Error ? error.message : error)}。纯浏览器打开时这是预期的——组播要由本地壳代收。`;
        list.replaceChildren(note);
      }
    }
    this.renderAddressBook();
  }

  /** 输入框里真正打过的字（没打就是空，不去碰占位称呼）。 */
  private typedNick(): string {
    return value(el(this.doc, 'nick'));
  }

  /**
   * 当前有效昵称 = 输入框 > 本机记住的上次 > 占位称呼。
   * 顺手把结果写回输入框：让玩家看见的名字就是将要发出去的那一个（原来两处各读各的，
   * 于是"界面显示空、发出去无名玩家"这种不一致是可能出现的）。
   */
  private currentNick(): string {
    const name = this.typedNick() || this.nick.get() || DEFAULT_NICK;
    const field = el(this.doc, 'nick') as HTMLInputElement | null;
    if (field && field.value !== name) field.value = name;
    return name;
  }

  /** 只记真正填过的名字。空字段与占位称呼都不写存储。 */
  private rememberNick(name: string): void {
    if (name && name !== DEFAULT_NICK) this.nick.set(name);
  }

  private connectTo(endpoint: Endpoint, code: string | null): void {
    this.endpoint = endpoint;
    this.resumeAttempted = false;
    // 先取"打过字的"再算有效昵称：currentNick() 会回填输入框，顺序反了就分不清是不是本人打的。
    const typed = this.typedNick();
    const nickValue = this.currentNick();
    this.rememberNick(typed);
    // 只有建房时才知道目标游戏就是下拉里选的这一款；加入/重连时房间游戏由房主决定，
    // 拿大厅里碰巧选中的版本去握手，会把“进别人的房”误判成 VERSION。
    const creating = this.pendingJoin?.type === 'roomCreate';
    const wantedGameId = creating
      ? this.pendingManifest?.id ?? (el(this.doc, 'game-select') as HTMLSelectElement | null)?.value ?? ''
      : '';
    const handlers: ConnectionHandlers = {
      hello: () => {
        const installed = this.localGames.find((g) => g.id === wantedGameId);
        return {
          type: 'hello',
          protocol: 1,
          nick: this.currentNick(),
          ...(installed ? { gameId: installed.id, version: installed.version } : {}),
        };
      },
      onMessage: (message) => this.onServerMessage(message, endpoint),
      onState: (state) => {
        this.connState = state;
        this.render();
      },
      onProtocolError: (reason) => this.setStatus(`协议不对：${reason}`),
      onConnectError: () => this.setStatus(`连不上 ${endpoint.httpOrigin}：那边没有房主端在听，检查地址与端口（房主要先跑「3178对战平台.bat」）`),
    };
    const options: ConnectionOptions = {
      factory: this.deps.factory ?? browserSocketFactory(),
      timers: this.deps.timers,
    };
    this.conn?.close();
    this.conn = new PlatformConnection(handlers, options);
    this.conn.connect(endpoint.wsUrl);
    this.book.touch(endpoint.httpOrigin, nickValue, code, Date.now());
    this.renderAddressBook();
    const session = code ? this.vault.load(endpoint.httpOrigin, code) : null;
    if (session) this.setStatus(`本机存有过这个房的票据，连上后先尝试坐回原位（座位 ${session.seatId}）`);
  }

  private onServerMessage(message: ServerMessage, endpoint: Endpoint): void {
    if ('serverNow' in message && typeof message.serverNow === 'number') this.clock.sync(message.serverNow);
    if (message.type === 'pong') this.clock.sync(message.serverNow);
    this.view = reduce(this.view, message, Date.now());
    if (message.type === 'welcome') {
      this.view = { ...this.view, availableGames: message.availableGames };
      const session = this.resumeRecord(endpoint);
      if (session) {
        this.conn?.send({ type: 'seatResume', code: session.roomCode, seatId: session.seatId, ticket: session.ticket });
        this.resumeAttempted = true;
      } else if (this.pendingJoin) {
        this.conn?.send(this.pendingJoin);
        this.pendingJoin = null;
      }
    }
    if (message.type === 'seatGranted') {
      this.vault.save(endpoint.httpOrigin, { roomCode: message.code, seatId: message.seatId, ticket: message.ticket, gameId: message.manifest.id }, Date.now());
      this.pendingManifest = message.manifest;
      void this.attachGameClient(message.manifest, endpoint);
    }
    if (message.type === 'snapshot') {
      const state = message.game as { deadlineInMs?: number | null } | null;
      // 相对毫秒 + 本地单调钟：绝对时间戳跨机器会失真。
      this.deadlineAt = state && typeof state.deadlineInMs === 'number' ? this.clock.now() + state.deadlineInMs : null;
    }
    if (message.type === 'error' && (message.code === 'NOROOM' || message.code === 'NOSEAT') && this.resumeAttempted) {
      this.resumeAttempted = false;
      const stale = this.resumeRecord(endpoint);
      if (stale) this.vault.clear(endpoint.httpOrigin, stale.roomCode);
      if (this.pendingJoin) {
        // 票据作废不代表你那一下不算数：按你原本点的（加入这个房）再走一次，别把请求吞了
        this.conn?.send(this.pendingJoin);
        this.pendingJoin = null;
      } else if (this.view.room) {
        // 还挂在房间界面上却没座位，席位行的"你"就是假招牌——先把它摘掉再说人话
        this.view = { ...this.view, mySeatId: null, ticket: null };
        this.setStatus('座位没了（多半是断线期间被电脑位或超时清掉，或别的设备顶了你）。重新入座才能继续操作。');
      } else {
        this.setStatus('上次那个房已经不在了，需要重新入座。');
      }
    }
    if (message.type === 'notice' && (message.code === 'HOSTLEFT' || message.code === 'ROOM_CLOSED')) {
      this.leaveToLobby();
    }
    if (message.type === 'event') this.client?.onEvent?.({ name: message.name, payload: message.payload }, this.gameActions());
    this.render();
  }

  private pendingJoin: ClientMessage | null = null;

  /** 这一页有没有可以坐回去的位置：按当前所在房（其次大厅输入的房号）翻本机票据。 */
  private resumeRecord(endpoint: Endpoint): SessionRecord | null {
    const lobbyCode = (value(el(this.doc, 'room-code')) || '').toUpperCase() || null;
    const code = resumeCodeFor(this.view, this.pendingJoin, lobbyCode);
    return code ? this.vault.load(endpoint.httpOrigin, code) : null;
  }

  private async attachGameClient(manifest: GameManifest, endpoint: Endpoint): Promise<void> {
    const attempt = ++this.attachSeq;
    const host = el(this.doc, 'game-host');
    if (!host) return;
    this.client?.unmount?.(host);
    const result = await loadGameClientSource(manifest, endpoint.httpOrigin, this.fetchImpl);
    if (attempt !== this.attachSeq) return;
    if (result.ok) {
      this.client = sandboxedClient(manifest, result.source, {
        baseUrl: result.baseUrl,
        platform: {
          chat: () => this.view.chat.slice(-100),
          room: () => this.view.room
            ? { code: this.view.room.code, phase: this.view.phase, seats: this.view.seats }
            : null,
        },
        onChat: (text) => this.sendSandboxChat(text),
        onError: (message) => {
          if (attempt !== this.attachSeq) return;
          const currentHost = el(this.doc, 'game-host');
          if (currentHost) this.client?.unmount?.(currentHost);
          this.client = placeholderClient(manifest);
          this.setStatus(message);
          this.renderGame();
        },
      });
      this.setStatus(result.verified ? `已挂载 ${manifest.name}（沙箱，哈希校验通过）` : `已挂载 ${manifest.name}（沙箱，房主未声明哈希，未校验）`);
    } else {
      this.client = placeholderClient(manifest);
      this.setStatus(result.reason ?? '用占位界面显示原始状态');
    }
    this.renderGame();
  }

  private gameActions(): GameActions {
    return {
      send: (name, payload) => this.command({ type: 'gameAction', name, payload }),
      seatId: () => this.view.mySeatId,
    };
  }

  /**
   * 房间里所有"改变局面"的命令都走这一条。
   * 不直接 send 是因为链路断了时 conn 会把消息攒进待发队列，等重连成功那一刻突然生效——
   * 玩家点了"开始对局"却什么都没发生，过一会儿对局自己开了。猴测就是在这个形状上抓到"点了没反应"的。
   */
  private command(message: ClientMessage): void {
    if (!this.conn || this.connState.status !== 'open') {
      this.setStatus('和房主的连接断了，这条没有发出去。先点「重新连接」，修好再点一次。');
      return;
    }
    this.conn.send(message);
  }

  private leaveToLobby(): void {
    this.attachSeq += 1;
    this.conn?.close();
    this.conn = null;
    this.view = emptyViewModel();
    const host = el(this.doc, 'game-host');
    if (host) this.client?.unmount?.(host);
    this.client = null;
    this.endpoint = null;
    this.drawerOpen = false;
    this.drawerWasPlaying = false;
    this.ruleConfigSignature = '';
    this.closeReference(false);
    this.applyDrawerState();
    // 状态行不清的话，房里留下的最后一句（挂载结果、被拒的原因）会一直挂在大厅上，
    // 看着像大厅出了错——用户就是拿着这句"房主没有提供 …（404）"来问的。
    this.setStatus('');
    this.render();
  }

  // ---------------- UI 绑定 ----------------

  private bindUi(): void {
    const on = (id: string, event: string, handler: () => void) => {
      const node = el(this.doc, id);
      node?.addEventListener(event, handler);
    };

    // 昵称即时记忆：改完就存，不必等到点「建房 / 加入」。原实现只在 connectTo 里写一次
    // `输入 || '无名玩家'`，于是两个后果：只改名没点按钮就刷新等于没改；某次空字段点下去
    // 就把"无名玩家"永久钉进存储——用户报的"每次进来都变回无名玩家"是这个。
    on('nick', 'input', () => this.rememberNick(this.typedNick()));

    on('btn-create', 'click', () => {
      void this.createRoom();
    });

    on('btn-join', 'click', () => {
      const raw = value(el(this.doc, 'host-address'));
      const parsed = parseHostAddress(raw);
      if (!parsed.ok) return this.setStatus(parsed.message);
      if (wouldBeBlocked(this.doc.defaultView?.location.protocol ?? 'http:', parsed.endpoint)) {
        return this.setStatus('这个页面是 https，连明文 ws 会被浏览器拦。要么用房主的 https 地址，要么用本机壳打开。');
      }
      const code = (value(el(this.doc, 'room-code')) || '').toUpperCase();
      if (!code) return this.setStatus('房号呢？房主那边能看到四位码。');
      this.pendingJoin = { type: 'roomJoin', code, password: value(el(this.doc, 'join-password')) || undefined };
      this.connectTo(parsed.endpoint, code);
      return undefined;
    });

    on('btn-ready', 'click', () => {
      const seat = mySeat(this.view);
      this.command({ type: 'ready', ready: !(seat?.ready ?? false) });
    });
    on('btn-send', 'click', () => this.sendChat());
    on('btn-leave', 'click', () => {
      if (isHost(this.view)) {
        this.command({ type: 'hostClose', reason: '房主解散房间' });
        return;
      }
      this.command({ type: 'seatLeave' });
      this.leaveToLobby();
    });
    on('btn-start', 'click', () => this.command({ type: 'hostStart' }));
    on('btn-close', 'click', () => this.command({ type: 'hostClose', reason: '房主关房' }));
    on('btn-transfer', 'click', () => {
      const select = el(this.doc, 'transfer-target') as HTMLSelectElement | null;
      if (select?.value) this.command({ type: 'hostTransfer', seatId: select.value });
    });
    on('btn-kick', 'click', () => {
      const select = el(this.doc, 'kick-target') as HTMLSelectElement | null;
      if (select?.value) this.command({ type: 'hostKick', seatId: select.value });
    });
    on('btn-add-ai', 'click', () => this.command({ type: 'hostSeat', op: 'addAi' }));
    on('btn-copy-invite', 'click', () => this.copyInvite());
    on('btn-reconnect', 'click', () => {
      // 猴测报"点了没反应"：它确实重连了，但界面一点反馈都没有，玩家以为按钮坏了
      this.setStatus('正在重连房主…');
      this.conn?.retryNow();
    });
    on('btn-use-book', 'click', () => {
      // 猴测报"点了没反应"：地址本来就和簿子里那条一样时，填完什么也没变，玩家看不出点没点上
      const select = el(this.doc, 'address-book') as HTMLSelectElement | null;
      if (!select?.value) return;
      const entry = this.book.list().find((e) => e.origin === select.value);
      if (!entry) {
        this.setStatus('这条地址已经不在簿子里了');
        this.renderAddressBook();
        return;
      }
      const address = el(this.doc, 'host-address') as HTMLInputElement | null;
      const code = el(this.doc, 'room-code') as HTMLInputElement | null;
      if (address) address.value = entry.origin;
      if (code && entry.lastCode) code.value = entry.lastCode;
      this.setStatus(entry.lastCode ? `已填入 ${entry.origin} 和房号 ${entry.lastCode}` : `已填入 ${entry.origin}，这条没记房号`);
      return undefined;
    });
    on('btn-forget', 'click', () => this.forgetOrigin(value(el(this.doc, 'address-book'))));
    const chatInput = el(this.doc, 'chat-input');
    chatInput?.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') this.sendChat();
    });
    on('btn-toggle-drawer', 'click', () => this.setDrawerOpen(!this.drawerOpen));
    on('btn-close-drawer', 'click', () => this.setDrawerOpen(false));
    on('drawer-backdrop', 'click', () => this.setDrawerOpen(false));
    on('btn-save-rule-config', 'click', () => this.saveRuleConfig());
    const bindReference = (id: string) => {
      el(this.doc, id)?.addEventListener('click', (event) => {
        this.openReference(event.currentTarget as HTMLElement);
      });
    };
    bindReference('btn-reference');
    bindReference('btn-reference-lobby');
    on('btn-reference-close', 'click', () => this.closeReference());
    on('reference-backdrop', 'click', () => this.closeReference());
    this.doc.defaultView?.addEventListener('keydown', (event) => this.onRoomShortcut(event));
    this.listboxes.attachAll();
  }

  private isPlayingLayout(): boolean {
    return this.view.phase === 'playing' || this.view.phase === 'ended';
  }

  private drawerHasContent(): boolean {
    const chatVisible = !(this.view.manifest?.ui?.chat === 'game' && this.view.phase === 'playing');
    const rulesVisible = Boolean(this.view.room && this.view.manifest?.ruleConfig);
    return chatVisible || rulesVisible || isHost(this.view);
  }

  // 房间头与房主台在两种布局里各有一个家：lobby 在左栏，playing 在顶部/右侧抽屉。
  // 只搬同一份 DOM，不复制表单，否则规则输入框与已填内容会跟着副本分叉。
  private placeRoomChrome(playing: boolean): void {
    const head = this.doc.querySelector<HTMLElement>('.room-head');
    const headParent = el(this.doc, playing ? 'room-playing-head' : 'room-left-head');
    if (head && headParent && head.parentElement !== headParent) headParent.append(head);
    const hostConsole = el(this.doc, 'host-console');
    const hostParent = el(this.doc, playing ? 'drawer-host' : 'room-left-host');
    if (hostConsole && hostParent && hostConsole.parentElement !== hostParent) hostParent.append(hostConsole);
  }

  private setDrawerOpen(open: boolean, focus = true): void {
    if (open) this.closeReference(false);
    const allowed = open && this.isPlayingLayout() && this.drawerHasContent();
    if (allowed === this.drawerOpen) {
      this.applyDrawerState();
      return;
    }
    this.drawerOpen = allowed;
    this.applyDrawerState();
    if (!focus) return;
    const target = el<HTMLButtonElement>(this.doc, this.drawerOpen ? 'btn-close-drawer' : 'btn-toggle-drawer');
    target?.focus();
  }

  private applyDrawerState(): void {
    const playing = this.isPlayingLayout();
    if (playing && !this.drawerHasContent()) this.drawerOpen = false;
    if (!playing) this.drawerOpen = false;
    el(this.doc, 'room-layout')?.classList.toggle('is-playing', playing);
    this.placeRoomChrome(playing);
    const toggle = el<HTMLButtonElement>(this.doc, 'btn-toggle-drawer');
    if (toggle) {
      toggle.classList.toggle('hidden', !playing || !this.drawerHasContent());
      toggle.setAttribute('aria-expanded', String(this.drawerOpen));
      toggle.title = this.drawerOpen
        ? '收起聊天与房主面板（快捷键 D）'
        : '打开聊天与房主面板（快捷键 D）';
    }
    const label = el(this.doc, 'drawer-toggle-label');
    if (label) label.textContent = this.drawerOpen ? '收起侧栏' : '侧栏';
    const drawer = el(this.doc, 'side-panels');
    if (drawer) {
      drawer.classList.toggle('is-open', playing && this.drawerOpen);
      // lobby 里侧栏就是普通三列，不能把它们从无障碍树里摘掉。
      drawer.setAttribute('aria-hidden', String(playing && !this.drawerOpen));
      drawer.toggleAttribute('inert', playing && !this.drawerOpen);
    }
    el(this.doc, 'drawer-backdrop')?.classList.toggle('hidden', !(playing && this.drawerOpen));
  }

  private onRoomShortcut(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape' && this.referenceOpen) {
      event.preventDefault();
      this.closeReference();
      return;
    }
    if (event.key === 'Escape' && this.drawerOpen) {
      event.preventDefault();
      this.setDrawerOpen(false);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== 'd' && event.key !== 'D') return;
    if (!this.isPlayingLayout()) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
    event.preventDefault();
    this.setDrawerOpen(!this.drawerOpen);
  }

  private selectedLobbyManifest(): GameManifest | null {
    const select = el(this.doc, 'game-select') as HTMLSelectElement | null;
    const id = select?.value;
    const games = this.localGames.length > 0 ? this.localGames : this.view.availableGames;
    return games.find((game) => game.id === id) ?? null;
  }

  private renderRuleConfig(): void {
    const panel = el(this.doc, 'rule-config');
    if (!panel) return;
    const manifest = this.view.manifest;
    const spec = manifest?.ruleConfig ? ruleConfigSpec(manifest.ruleConfig) : null;
    if (!spec || !this.view.room) {
      panel.classList.add('hidden');
      this.ruleConfigSignature = '';
      this.syncHostConsole();
      return;
    }
    const canEdit = isHost(this.view) && this.view.phase === 'lobby';
    const config = this.view.room.config;
    const signature = [
      this.view.room.code,
      manifest?.id,
      manifest?.version,
      JSON.stringify(manifest?.ruleConfig),
      JSON.stringify(config),
      canEdit,
      this.view.phase,
    ].join('|');
    if (signature === this.ruleConfigSignature) return;
    this.ruleConfigSignature = signature;
    panel.classList.remove('hidden');
    const hint = el(this.doc, 'rule-config-hint');
    if (hint) {
      hint.textContent = canEdit ? '仅房主可操作' : isHost(this.view) ? '对局中不可修改' : '只有房主可以修改';
    }
    el(this.doc, 'rule-config-actions')?.classList.toggle('hidden', !canEdit);
    const status = el(this.doc, 'rule-config-status');
    if (status) status.textContent = '';
    const body = el(this.doc, 'rule-config-body');
    if (!body) return;
    body.replaceChildren();
    if (!canEdit) {
      const rows = ruleConfigSummary(spec, config);
      body.append(
        ...rows.map((row) => {
          const chip = this.doc.createElement('span');
          chip.className = 'rule-chip';
          const label = this.doc.createElement('span');
          label.className = 'rule-chip-label';
          label.textContent = row.label;
          const value = this.doc.createElement('span');
          value.className = 'rule-chip-value';
          value.textContent = row.text;
          chip.append(label, value);
          return chip;
        }),
      );
      return;
    }
    for (const field of spec.fields) {
      const wrap = this.doc.createElement('div');
      wrap.className = 'rule-field';
      const id = `room-rule-${field.key}`;
      const current = config[field.key] ?? field.default;
      if (field.type === 'boolean') {
        const check = this.doc.createElement('div');
        check.className = 'form-check form-switch';
        const input = this.doc.createElement('input');
        input.className = 'form-check-input';
        input.type = 'checkbox';
        input.id = id;
        input.checked = current === true;
        const label = this.doc.createElement('label');
        label.className = 'form-check-label';
        label.htmlFor = id;
        label.textContent = field.label;
        check.append(input, label);
        wrap.append(check);
      } else {
        const label = this.doc.createElement('label');
        label.className = 'form-label';
        label.htmlFor = id;
        label.textContent = field.label;
        wrap.append(label);
        if (field.type === 'enum') {
          const select = this.doc.createElement('select');
          select.className = 'form-select';
          select.id = id;
          for (const option of field.options) {
            const node = this.doc.createElement('option');
            node.value = option.value;
            node.textContent = option.label;
            select.append(node);
          }
          const value = typeof current === 'string' && field.options.some((option) => option.value === current)
            ? current
            : field.default;
          select.value = value;
          wrap.append(select);
        } else {
          const input = this.doc.createElement('input');
          input.className = 'form-control';
          input.type = 'number';
          input.id = id;
          input.min = String(field.min);
          input.max = String(field.max);
          if (field.step !== undefined) input.step = String(field.step);
          const value = typeof current === 'number' && Number.isFinite(current) ? current : field.default;
          input.value = String(value);
          wrap.append(input);
        }
      }
      if (field.description) {
        const description = this.doc.createElement('p');
        description.className = 'hint';
        description.textContent = field.description;
        wrap.append(description);
      }
      body.append(wrap);
    }
    this.listboxes.attachAll();
    this.listboxes.syncAll();
    this.syncHostConsole();
  }

  private syncHostConsole(): void {
    const panel = el(this.doc, 'host-console');
    if (!panel) return;
    const spec = this.view.manifest?.ruleConfig ? ruleConfigSpec(this.view.manifest.ruleConfig) : null;
    const host = isHost(this.view);
    const show = Boolean(this.view.room) && (Boolean(spec) || host);
    panel.classList.toggle('hidden', !show);
    el(this.doc, 'room-left')?.classList.toggle('has-console', show);
    panel.classList.toggle('has-rules', Boolean(spec));
    panel.classList.toggle('is-host', host);
    el(this.doc, 'rule-config')?.classList.toggle('hidden', !spec);
    const title = el(this.doc, 'rule-config-title');
    if (title) title.textContent = spec ? (host ? '本局规则与房主操作' : '本局规则') : (host ? '房主控制台' : '');
    const hint = el(this.doc, 'rule-config-hint');
    if (hint) {
      hint.textContent = spec
        ? (host && this.view.phase === 'lobby' ? '仅房主可操作' : host ? '对局中不可修改' : '只有房主可以修改')
        : (host ? '仅房主可操作' : '');
    }
  }

  private saveRuleConfig(): void {
    const manifest = this.view.manifest;
    const spec = manifest?.ruleConfig ? ruleConfigSpec(manifest.ruleConfig) : null;
    if (!spec || !isHost(this.view) || this.view.phase !== 'lobby') return;
    const config = ruleConfigFromValues(spec, (field) => {
      const node = el(this.doc, `room-rule-${field.key}`) as HTMLInputElement | HTMLSelectElement | null;
      if (!node) return undefined;
      return field.type === 'boolean' ? (node as HTMLInputElement).checked : node.value;
    });
    this.command({ type: 'ruleConfig', config });
    const status = el(this.doc, 'rule-config-status');
    if (status) status.textContent = '已提交，等待房间确认…';
  }

  private seatOptionFieldsFor(seat: SeatView): SeatOptionField[] {
    const raw = this.view.manifest?.seatOptions;
    if (!raw) return [];
    const spec = seatOptionsSpec(raw);
    return spec ? seatOptionFields(spec, seat.role) : [];
  }

  private seatColorField(seat: SeatView): SeatOptionField | null {
    const fields = this.seatOptionFieldsFor(seat);
    return fields.find((field) => field.type === 'enum' && field.options.length > 0 && field.options.every((option) => Boolean(option.color)))
      ?? null;
  }

  private seatDifficultyField(seat: SeatView): SeatOptionField | null {
    if (seat.role !== 'ai') return null;
    const fields = this.seatOptionFieldsFor(seat);
    return fields.find((field) => field.type === 'enum' && field.key === 'difficulty')
      ?? fields.find((field) => field.type === 'enum' && !field.options.every((option) => Boolean(option.color)))
      ?? null;
  }

  private attachSeatColor(row: HTMLElement, seat: SeatView): void {
    const field = this.seatColorField(seat);
    if (!field || field.type !== 'enum') return;
    const selected = field.options.find((option) => option.value === seat.options[field.key])
      ?? field.options.find((option) => option.value === field.default);
    if (selected?.color) {
      row.classList.add('has-seat-color');
      row.style.setProperty('--seat-color', selected.color);
    }
    if (!isHost(this.view) || this.view.phase !== 'lobby') return;
    const oldSlot = row.querySelector('.seat-slot');
    if (!oldSlot) return;
    const trigger = this.doc.createElement('button');
    trigger.type = 'button';
    trigger.className = 'seat-slot seat-slot-button';
    trigger.textContent = oldSlot.textContent;
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', `设置 ${seat.name} 的座位颜色`);
    trigger.title = '设置座位颜色';
    oldSlot.replaceWith(trigger);
    const menu = this.doc.createElement('div');
    menu.className = 'seat-color-menu hidden';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', `${seat.name} 的座位颜色`);
    for (const option of field.options) {
      const choice = this.doc.createElement('button');
      choice.type = 'button';
      choice.className = 'seat-color-option';
      choice.style.backgroundColor = option.color ?? '';
      choice.title = option.label;
      choice.setAttribute('aria-label', option.label);
      choice.setAttribute('aria-selected', String(selected?.value === option.value));
      choice.addEventListener('click', () => {
        const options = { ...seat.options, [field.key]: option.value };
        this.command({ type: 'hostSeat', op: 'setOptions', seatId: seat.seatId, options });
        menu.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
      });
      menu.append(choice);
    }
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = menu.classList.contains('hidden');
      for (const other of this.doc.querySelectorAll('.seat-color-menu:not(.hidden)')) other.classList.add('hidden');
      menu.classList.toggle('hidden', !opening);
      trigger.setAttribute('aria-expanded', String(opening));
    });
    row.append(menu);
  }

  private attachAiDifficulty(row: HTMLElement, seat: SeatView): void {
    const field = this.seatDifficultyField(seat);
    if (!field || field.type !== 'enum') return;
    const select = this.doc.createElement('select');
    select.className = 'seat-ai-difficulty';
    select.setAttribute('aria-label', `设置 ${seat.name} 的电脑强度`);
    for (const option of field.options) {
      const node = this.doc.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      select.append(node);
    }
    const current = seat.options[field.key];
    select.value = typeof current === 'string' && field.options.some((option) => option.value === current)
      ? current
      : field.default;
    select.disabled = !isHost(this.view) || this.view.phase !== 'lobby';
    select.addEventListener('change', () => {
      const options = { ...seat.options, [field.key]: select.value };
      this.command({ type: 'hostSeat', op: 'setOptions', seatId: seat.seatId, options });
    });
    row.append(select);
  }

  private attachSeatTransfer(row: HTMLElement, seat: SeatView): void {
    if (!isHost(this.view) || this.view.phase !== 'lobby' || seat.role !== 'player') return;
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-outline-secondary seat-transfer-button';
    button.textContent = '转交房主';
    button.title = `把房主转交给 ${seat.name}`;
    button.setAttribute('aria-label', `把房主转交给 ${seat.name}`);
    button.addEventListener('click', () => {
      this.command({ type: 'hostTransfer', seatId: seat.seatId });
    });
    row.append(button);
  }

  private currentReferenceManifest(): GameManifest | null {
    if (!this.view.room) return this.selectedLobbyManifest();
    return this.view.manifest ?? this.localGames.find((game) => game.id === this.view.room?.gameId) ?? null;
  }

  private referenceOrigin(): string {
    return this.view.room && this.endpoint ? this.endpoint.httpOrigin : this.selfOrigin;
  }

  private openReference(trigger: HTMLElement): void {
    const manifest = this.currentReferenceManifest();
    if (!manifest) {
      this.setStatus('先选一个游戏，或进入房间后再看规则与资料。');
      return;
    }
    this.referenceTrigger = trigger;
    this.referenceOpen = true;
    this.referenceSeq += 1;
    this.setDrawerOpen(false, false);
    this.applyReferenceState();
    el<HTMLButtonElement>(this.doc, 'btn-reference-close')?.focus();
    void this.showReference(manifest, this.referenceSeq);
  }

  private applyReferenceState(): void {
    const panel = el(this.doc, 'reference-panel');
    if (panel) {
      panel.classList.toggle('is-open', this.referenceOpen);
      panel.setAttribute('aria-hidden', String(!this.referenceOpen));
      panel.toggleAttribute('inert', !this.referenceOpen);
    }
    el(this.doc, 'reference-backdrop')?.classList.toggle('hidden', !this.referenceOpen);
    for (const id of ['btn-reference', 'btn-reference-lobby']) {
      el(this.doc, id)?.setAttribute('aria-expanded', String(this.referenceOpen));
    }
  }

  private closeReference(focus = true): void {
    if (!this.referenceOpen) return;
    this.referenceOpen = false;
    this.referenceSeq += 1;
    this.applyReferenceState();
    if (!focus) return;
    const trigger = this.referenceTrigger;
    if (trigger?.isConnected && !trigger.classList.contains('hidden')) trigger.focus();
    else el<HTMLButtonElement>(this.doc, 'btn-reference')?.focus();
  }

  private async showReference(manifest: GameManifest, seq: number): Promise<void> {
    const body = el(this.doc, 'reference-body');
    const title = el(this.doc, 'reference-title');
    if (!body || !title) return;
    const origin = this.referenceOrigin();
    const key = `${origin}|${manifest.id}|${manifest.version}|${manifest.reference?.entry ?? ''}`;
    const cached = this.referenceCache.get(key);
    if (cached) {
      this.paintReference(cached, manifest, origin);
      return;
    }
    body.textContent = '正在读取规则与资料…';
    title.textContent = '规则与资料';
    const result = await loadGameReference(manifest, origin, this.fetchImpl);
    if (seq !== this.referenceSeq || !this.referenceOpen) return;
    if (result.ok) this.referenceCache.set(key, result);
    this.paintReference(result, manifest, origin);
  }

  private paintReference(result: ReferenceLoad, manifest: GameManifest, origin: string): void {
    const body = el(this.doc, 'reference-body');
    const title = el(this.doc, 'reference-title');
    if (!body || !title) return;
    if (result.ok) {
      title.textContent = renderReference(body, result.doc, origin, manifest.id);
      return;
    }
    body.replaceChildren();
    const message = this.doc.createElement('p');
    message.className = 'reference-error';
    message.textContent = result.message;
    body.append(message);
    title.textContent = '规则与资料';
  }

  private async prepareHostMode(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.selfOrigin}/api/host/ready`, { method: 'POST' });
      if (response.status === 404 || response.status === 405) return true;
      const data = (await response.json()) as { ok?: boolean; reason?: string; publicOrigin?: string | null; lanOrigins?: unknown };
      if (data.ok === false) {
        this.setStatus(data.reason || '本机壳不能开房；用「3178对战平台.bat」重新打开');
        return false;
      }
      if (data.ok) {
        if (data.publicOrigin) this.inviteOrigin = data.publicOrigin;
        if (Array.isArray(data.lanOrigins)) this.lanOrigins = data.lanOrigins.filter((item): item is string => typeof item === 'string');
      }
      return true;
    } catch {
      // 老壳/纯浏览器没有这个端点：保持原有建房路径，让它自己报连接错误。
      return true;
    }
  }

  private async createRoom(): Promise<void> {
    this.setStatus('正在开启局域网入口…');
    if (!(await this.prepareHostMode())) return;
    const gameSelect = el(this.doc, 'game-select') as HTMLSelectElement | null;
    const gameId = gameSelect?.value || 'fixture-turn';
    const manifest = this.selectedLobbyManifest() ?? this.view.availableGames.find((g) => g.id === gameId) ?? null;
    this.pendingManifest = manifest;
    this.pendingJoin = null;
    const endpoint = parseHostAddress(this.selfOrigin);
    if (!endpoint.ok) {
      this.setStatus(endpoint.message);
      return;
    }
    this.connCreateFrom(endpoint.endpoint, {
      gameId,
      roomName: value(el(this.doc, 'room-name')) || '未命名房间',
      seatSlots: Number(value(el(this.doc, 'seat-slots')) || 4),
      password: value(el(this.doc, 'room-password')) || undefined,
      allowSpectate: (el(this.doc, 'chk-spectate') as HTMLInputElement | null)?.checked ?? true,
      hidden: (el(this.doc, 'chk-hidden') as HTMLInputElement | null)?.checked ?? false,
      config: {},
    });
  }

  private connCreateFrom(endpoint: Endpoint, input: { gameId: string; roomName: string; seatSlots: number; password?: string; allowSpectate: boolean; hidden: boolean; config: Record<string, unknown> }): void {
    this.connectTo(endpoint, null);
    this.pendingJoin = {
      type: 'roomCreate',
      gameId: input.gameId,
      roomName: input.roomName,
      seatSlots: input.seatSlots,
      password: input.password,
      allowSpectate: input.allowSpectate,
      hidden: input.hidden,
      config: input.config,
    };
  }

  private forgetOrigin(origin: string): void {
    if (!origin) return;
    this.book.forget(origin);
    this.renderAddressBook();
    this.setStatus(`已从地址簿忘掉 ${origin}`);
  }

  private sendChat(): void {
    const input = el(this.doc, 'chat-input') as HTMLInputElement | null;
    const text = input?.value.trim() ?? '';
    if (!text) return;
    this.conn?.send({ type: 'chat', text });
    input!.value = '';
  }

  private sendSandboxChat(value: unknown): void {
    const text = sandboxChatText(value, this.view.phase, this.connState.status);
    if (!text) return;
    this.conn?.send({ type: 'chat', text });
  }

  /**
   * 邀请链接该用哪个地址：host 模式由壳给出局域网/隧道入口。
   * 老壳没有 /api/self 时保持页面自己的来源——行为与以前一致，不会因为升级前端就发不出链接。
   */
  private async loadSelfInfo(): Promise<void> {
    try {
      const response = await this.fetchImpl(`${this.selfOrigin}/api/self`);
      if (!response.ok) return;
      const info = (await response.json()) as { publicOrigin?: string | null; lanOrigins?: unknown };
      if (info.publicOrigin) this.inviteOrigin = info.publicOrigin;
      if (Array.isArray(info.lanOrigins)) this.lanOrigins = info.lanOrigins.filter((item): item is string => typeof item === 'string');
    } catch {
      // 纯浏览器打开或老壳：没有这个端点
    }
  }

  private copyInvite(): void {
    void this.loadSelfInfo().then(() => {
      const link = this.inviteUrl();
      const node = el(this.doc, 'invite-url') as HTMLInputElement | null;
      if (node) node.value = link;
      void this.doc.defaultView?.navigator.clipboard?.writeText(link).then(
        () => this.setStatus('邀请链接已复制，发给朋友点开就填好地址和房号'),
        () => this.setStatus(`复制失败，手动拷这条：${link}`),
      );
    });
  }

  private inviteUrl(): string {
    if (!this.view.room || !this.endpoint) return '';
    // 本机页面在 127.0.0.1 上，但朋友要用局域网/隧道地址才点得开；
    // 连接仍走 this.endpoint（本机界面口），这里只换链接里写的地址。
    return inviteLink(this.inviteOrigin, this.view.room.code, this.view.room.gameId, pathOf(this.endpoint.wsUrl));
  }

  private setStatus(text: string): void {
    const node = el(this.doc, 'lobby-status');
    if (node) node.textContent = text;
    const bar = el(this.doc, 'connection-bar');
    if (bar && this.view.room) bar.textContent = text;
  }

  // ---------------- 渲染 ----------------

  private render(): void {
    const inRoom = this.view.room !== null;
    el(this.doc, 'screen-lobby')?.classList.toggle('hidden', inRoom);
    el(this.doc, 'screen-room')?.classList.toggle('hidden', !inRoom);
    if (inRoom) {
      this.renderRoom();
      this.renderChat();
      this.renderHostPanel();
      this.renderGame();
    }
    // 这两个必须在重建选项之后跑，否则读到的是上一帧的候选数（自绘下拉就栽过这个顺序）
    this.listboxes.syncAll();
    this.syncActionAvailability();
  }

  /**
   * 每个动作按钮在渲染时都要问一句"此刻这个动作合法吗"，不合法就变灰。
   * 猴测抓出来的三类死点击（加电脑位 / 移交 / 请出 / 用地址簿）全是这个形状：
   * 不崩、不抛异常，只是点了被静默丢掉，玩家只能自己去猜。
   */
  private syncActionAvailability(): void {
    const setDisabled = (id: string, blocked: boolean) => {
      const node = el(this.doc, id) as HTMLButtonElement | null;
      if (node) node.disabled = blocked;
    };
    // 统一按"这个下拉当下有没有可选中的值"判，而不是各查各的：
    // 光看 options.length 会漏掉"只有占位空值"的情况，按钮亮着但点下去静默丢掉。
    const hasTarget = (selectId: string) => Boolean((el(this.doc, selectId) as HTMLSelectElement | null)?.value);
    setDisabled('btn-use-book', !hasTarget('address-book'));
    setDisabled('btn-forget', !hasTarget('address-book'));
    setDisabled('btn-transfer', !hasTarget('transfer-target'));
    setDisabled('btn-kick', !hasTarget('kick-target'));
  }

  private renderRoom(): void {
    const playing = this.isPlayingLayout();
    // 每次从 lobby 进入对局都从"抽屉收起"开始；对局中重绘不能把玩家打开的抽屉关掉。
    if (playing && !this.drawerWasPlaying) this.drawerOpen = false;
    this.drawerWasPlaying = playing;
    this.applyDrawerState();
    const chatPanel = el(this.doc, 'chat-panel');
    if (chatPanel) {
      chatPanel.classList.toggle('hidden', this.view.manifest?.ui?.chat === 'game' && this.view.phase === 'playing');
    }
    const title = el(this.doc, 'room-title');
    const meta = el(this.doc, 'room-meta');
    const codeChip = el(this.doc, 'room-code-hud');
    if (title && this.view.room) {
      const room = this.view.room;
      const phase = room.phase === 'lobby' ? '等待入座' : room.phase === 'playing' ? '对局中' : '已结束';
      title.textContent = room.name;
      if (meta) meta.textContent = `${room.gameName} · ${phase}`;
    }
    if (codeChip && this.view.room) codeChip.textContent = this.view.room.code;
    this.renderRuleConfig();
    const grid = el(this.doc, 'seat-grid');
    if (!grid) return;
    grid.replaceChildren();
    // 一律 createElement + textContent：昵称是别人机器上打的字，不能进 innerHTML
    const pushRow = (className: string, slot: number | null, name: string, state: string, tooltip: string, icon: string | null) => {
      const row = this.doc.createElement('div');
      row.className = className;
      if (tooltip) row.title = tooltip;
      const iconCell = this.doc.createElement('i');
      iconCell.className = icon ? `seat-icon ti ${icon}` : 'seat-icon';
      iconCell.setAttribute('aria-hidden', 'true');
      const slotCell = this.doc.createElement('span');
      slotCell.className = 'seat-slot';
      slotCell.textContent = slot === null ? '—' : String(slot);
      const nameCell = this.doc.createElement('span');
      nameCell.className = 'seat-name';
      nameCell.textContent = name;
      const stateCell = this.doc.createElement('span');
      stateCell.className = 'seat-state';
      stateCell.textContent = state;
      row.append(iconCell, slotCell, nameCell, stateCell);
      grid.append(row);
      return row;
    };
    for (const seat of this.view.seats) {
      const me = seat.seatId === this.view.mySeatId;
      const classes = ['seat', `seat-${seat.role}`];
      if (seat.ready && seat.role !== 'spectator' && seat.role !== 'ai') classes.push('is-ready');
      if (me) classes.push('is-me');
      if (!seat.connected && seat.role !== 'ai') classes.push('is-offline');
      const icon = seat.role === 'host' ? 'ti-crown' : seat.role === 'ai' ? 'ti-robot' : seat.role === 'spectator' ? 'ti-eye' : seat.ready ? 'ti-circle-check' : 'ti-user';
      const row = pushRow(classes.join(' '), seat.slot, seat.name, this.seatStateText(seat), seatLabel(seat), icon);
      this.attachSeatColor(row, seat);
      this.attachAiDifficulty(row, seat);
      this.attachSeatTransfer(row, seat);
    }
    for (const slot of emptySlots(this.view)) {
      pushRow('seat seat-empty', slot, '空位', '等待加入', `${slot} 号位空着`, 'ti-plug');
    }
    const invite = el(this.doc, 'invite-url') as HTMLInputElement | null;
    if (invite && !invite.value) invite.value = this.inviteUrl();
    const access = el(this.doc, 'lan-access');
    if (access) {
      const hints = accessHints(this.lanOrigins, this.view.room?.code ?? null);
      access.textContent = hints.join('\n');
      access.classList.toggle('hidden', hints.length === 0);
    }
    const countdown = el(this.doc, 'turn-countdown');
    const countdownBlock = el(this.doc, 'countdown-block');
    countdownBlock?.classList.toggle('hidden', this.deadlineAt === null);
    if (countdown) {
      countdown.textContent =
        this.deadlineAt === null ? '' : `剩 ${Math.max(0, Math.round((this.deadlineAt - this.clock.now()) / 1000))} 秒`;
    }
    const bar = el(this.doc, 'connection-bar');
    if (bar) {
      const link = isHost(this.view) ? '你就是房主（已连本机壳）' : '已连房主';
      const status = this.connState.status === 'open' ? link : `连接：${this.connState.status}`;
      const notice = this.view.lastNotice ? ` · ${this.view.lastNotice.text || NOTICE_MESSAGES[this.view.lastNotice.code]}` : '';
      const error = this.view.lastError ? ` · ${this.view.lastError.message}` : '';
      bar.textContent = `${status}${notice}${error}${this.connState.lastError ? ` · ${this.connState.lastError}` : ''}`;
    }
  }

  private seatStateText(seat: SeatView): string {
    if (seat.role === 'spectator') return '观战';
    if (seat.role === 'ai') return '电脑';
    if (!seat.connected) return '离线';
    if (seat.role === 'host') return '房主';
    return seat.ready ? '已准备' : '未准备';
  }

  private renderChat(): void {
    const log = el(this.doc, 'chat-log');
    if (!log) return;
    log.replaceChildren(
      ...this.view.chat.slice(-60).map((line) => {
        const row = this.doc.createElement('div');
        row.className = `chat-line chat-${line.kind}`;
        row.textContent = line.kind === 'system' ? line.text : `${line.name}：${line.text}`;
        return row;
      }),
    );
    log.scrollTop = log.scrollHeight;
  }

  private renderHostPanel(): void {
    const panel = el(this.doc, 'host-panel');
    if (!panel) return;
    panel.classList.toggle('hidden', !isHost(this.view));
    const blockers = startBlockers(this.view);
    const startButton = el(this.doc, 'btn-start') as HTMLButtonElement | null;
    if (startButton) {
      startButton.classList.toggle('hidden', !isHost(this.view));
      startButton.disabled = this.view.phase !== 'lobby' || !blockers.ok;
      startButton.textContent = blockers.tooFew
        ? '人还不够'
        : blockers.unready.length > 0
          ? `等准备：${blockers.unready.join('、')}`
          : '开始对局';
    }
    const leaveButton = el(this.doc, 'btn-leave') as HTMLButtonElement | null;
    if (leaveButton) {
      const host = isHost(this.view);
      leaveButton.textContent = host ? '解散房间' : '离开';
      leaveButton.title = host ? '关闭房间，所有人回到大厅' : '离开座位，回到大厅';
    }
    // lobby 用席位行里的「转交房主」；对局中席位压成状态条，退回房主台的下拉。
    el(this.doc, 'host-transfer-control')?.classList.toggle('hidden', this.view.phase === 'lobby');
    const readyButton = el(this.doc, 'btn-ready') as HTMLButtonElement | null;
    const seat = mySeat(this.view);
    if (readyButton) {
      // 原来只在"有座位且不是房主"时才更新，于是座位一消失，按钮就停在上一次的可点状态：
      // 点下去服务端回一句"你还没有座位"，看着像界面在骗人。这里三种不可点的身份各给一句原因。
      const role = seat?.role;
      readyButton.disabled = role !== 'player' || this.view.phase !== 'lobby';
      readyButton.textContent = !seat
        ? '先入座'
        : role === 'host'
          ? '房主不用准备'
          : role === 'spectator'
            ? '观战不能准备'
            : seat.ready
              ? '取消准备'
              : '准备';
    }
    // 加电脑位：游戏不支持填充或槽位已满时直接变灰并写明原因，别让人点了去找那行小字
    const aiButton = el(this.doc, 'btn-add-ai') as HTMLButtonElement | null;
    if (aiButton) {
      const blocker = aiFillBlocker(this.view);
      aiButton.disabled = blocker !== null;
      const label = [...aiButton.childNodes].find((n) => n.nodeType === 3);
      if (label) label.nodeValue = blocker ?? '加一个电脑位';
    }
    for (const [id, kind] of [['transfer-target', 'transfer'], ['kick-target', 'kick']] as const) {
      const select = el(this.doc, id) as HTMLSelectElement | null;
      if (!select) continue;
      const candidates = seatPickerCandidates(this.view, kind);
      const blocker = seatPickerBlocker(this.view, kind);
      const previous = select.value;
      select.replaceChildren(
        ...candidates.map((s) => {
          const option = this.doc.createElement('option');
          option.value = s.seatId;
          option.textContent = `${s.slot} 号 · ${s.name}`;
          return option;
        }),
        // 没得选的时候别留白：把原因当成一条不可选的占位项放进格子里。
        // value 是空串，所以 syncActionAvailability 依旧会把旁边的按钮挡住。
        ...(blocker ? [this.placeholderOption(blocker)] : []),
      );
      if (candidates.some((s) => s.seatId === previous)) select.value = previous;
    }
    this.syncHostConsole();
  }

  private renderGame(): void {
    const host = el(this.doc, 'game-host');
    if (!host) return;
    const playing = this.view.phase === 'playing' || this.view.phase === 'ended';
    host.classList.toggle('hidden', !playing);
    if (playing && this.client) this.client.mount(host, this.view.game, this.gameActions());
  }

  private renderAddressBook(): void {
    const select = el(this.doc, 'address-book') as HTMLSelectElement | null;
    if (!select) return;
    const entries = this.book.list();
    select.replaceChildren(
      ...(entries.length === 0
        ? [this.option('', '（还没有去过任何房主）')]
        : entries.map((e) => this.option(e.origin, `${e.label} · ${e.origin}${e.lastCode ? ` · 上次房号 ${e.lastCode}` : ''}`))),
    );
    this.listboxes.syncAll();
    // 这里不走 render()，所以要自己补一次可用性同步：地址簿一被换成"（还没有去过任何房主）"，
    // 那两个按钮会停在上一帧的亮着状态——猴测的"点了没反应"就是这么来的。
    this.syncActionAvailability();
  }

  private renderLanList(rooms: Array<{ code: string; name: string; gameName: string; occupied: number; seatSlots: number; lanUrl: string; hostName: string }>): void {
    const list = el(this.doc, 'lan-list');
    if (!list) return;
    list.replaceChildren();
    if (rooms.length === 0) {
      const empty = this.doc.createElement('p');
      empty.className = 'lan-empty';
      empty.textContent = '局域网里暂时没有房间。房主也要装本地壳，且首次绑定时要在 Windows 弹窗里点"允许"。';
      list.append(empty);
      return;
    }
    for (const room of rooms) {
      const row = this.doc.createElement('button');
      row.type = 'button';
      row.className = 'lan-room';
      row.textContent = `${room.name} · ${room.gameName} · ${room.occupied}/${room.seatSlots} · 房主 ${room.hostName}`;
      row.addEventListener('click', () => {
        const parsed = parseHostAddress(room.lanUrl);
        if (!parsed.ok) return this.setStatus(parsed.message);
        const address = el(this.doc, 'host-address') as HTMLInputElement | null;
        const code = el(this.doc, 'room-code') as HTMLInputElement | null;
        if (address) address.value = parsed.endpoint.httpOrigin;
        if (code) code.value = room.code;
        this.pendingJoin = { type: 'roomJoin', code: room.code };
        this.connectTo(parsed.endpoint, room.code);
        return undefined;
      });
      list.append(row);
    }
  }

  private option(valueText: string, text: string): HTMLOptionElement {
    const option = this.doc.createElement('option');
    option.value = valueText;
    option.textContent = text;
    return option;
  }

  /** 空下拉里的"为什么是空的"：不可选、value 留空，所以旁边的按钮照样会被挡住。 */
  private placeholderOption(text: string): HTMLOptionElement {
    const option = this.option('', text);
    option.disabled = true;
    return option;
  }
}

function pathOf(wsUrl: string): string {
  const match = /^wss?:\/\/[^/]+(\/.*)$/.exec(wsUrl);
  return match?.[1] ?? '/ws';
}
