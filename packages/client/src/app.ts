import type { ClientMessage, GameManifest, SeatView, ServerMessage } from '@bp/protocol';
import { NOTICE_MESSAGES } from '@bp/protocol';
import { PlatformConnection, browserSocketFactory, type ConnectionHandlers, type ConnectionOptions, type SocketFactory, type Timers, type ConnectionState } from './connection.js';
import { AddressBook, NickName, SessionVault, type KeyValueStore, type SessionRecord } from './local-store.js';
import { ServerClock } from './clock.js';
import { parseHostAddress, parseInviteLink, wouldBeBlocked, type Endpoint } from './endpoint.js';
import { aiFillBlocker, emptyViewModel, inviteLink, isHost, mySeat, reduce, resumeCodeFor, seatLabel, startBlockers, emptySlots, type ViewModel } from './view-model.js';
import { fetchGameList, loadGameClient, placeholderClient, type FetchImpl, type GameActions, type GameClientContract } from './module-loader.js';
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

export class PlatformApp {
  private readonly doc: Document;
  private readonly book: AddressBook;
  private readonly nick: NickName;
  private readonly vault: SessionVault;
  private readonly clock: ServerClock;
  private readonly fetchImpl: FetchImpl;
  private readonly selfOrigin: string;
  private view: ViewModel = emptyViewModel();
  private conn: PlatformConnection | null = null;
  private endpoint: Endpoint | null = null;
  private connState: ConnectionState = { status: 'idle', attempts: 0, lastError: null, wsUrl: null };
  private client: GameClientContract | null = null;
  private pendingManifest: GameManifest | null = null;
  private localGames: GameManifest[] = [];
  private renderHandle: unknown = null;
  private deadlineAt: number | null = null;
  private resumeAttempted = false;
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

  private connectTo(endpoint: Endpoint, code: string | null): void {
    this.endpoint = endpoint;
    this.resumeAttempted = false;
    const nickValue = value(el(this.doc, 'nick')) || '无名玩家';
    this.nick.set(nickValue);
    const wantedGameId = this.pendingManifest?.id ?? (el(this.doc, 'game-select') as HTMLSelectElement | null)?.value ?? '';
    const handlers: ConnectionHandlers = {
      hello: () => {
        // 只声明版本号让房主做版本闸；房规由房主选，本机不该拿自己的 hash 去比。
        const installed = this.localGames.find((g) => g.id === wantedGameId);
        return {
          type: 'hello',
          protocol: 1,
          nick: value(el(this.doc, 'nick')) || '无名玩家',
          gameId: installed?.id,
          version: installed?.version,
        };
      },
      onMessage: (message) => this.onServerMessage(message, endpoint),
      onState: (state) => {
        this.connState = state;
        this.render();
      },
      onProtocolError: (reason) => this.setStatus(`协议不对：${reason}`),
      onConnectError: () => this.setStatus(`连不上 ${endpoint.httpOrigin}：那边没有房主端在听，检查地址与端口（房主要先跑「房主建房.bat」）`),
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
    const host = el(this.doc, 'game-host');
    if (!host) return;
    const result = await loadGameClient(manifest, endpoint.httpOrigin, this.fetchImpl);
    if (result.ok && result.client) {
      this.client = result.client;
      this.setStatus(result.verified ? `已挂载 ${manifest.name}（哈希校验通过）` : `已挂载 ${manifest.name}（房主未声明哈希，未校验）`);
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
    this.conn?.close();
    this.conn = null;
    this.view = emptyViewModel();
    this.client = null;
    this.endpoint = null;
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

    on('btn-create', 'click', () => {
      const gameSelect = el(this.doc, 'game-select') as HTMLSelectElement | null;
      const gameId = gameSelect?.value || 'echo';
      const manifest = this.view.availableGames.find((g) => g.id === gameId) ?? null;
      this.pendingManifest = manifest;
      this.pendingJoin = null;
      const endpoint = parseHostAddress(this.selfOrigin);
      if (!endpoint.ok) return this.setStatus(endpoint.message);
      this.connCreateFrom(endpoint.endpoint, {
        gameId,
        roomName: value(el(this.doc, 'room-name')) || '未命名房间',
        seatSlots: Number(value(el(this.doc, 'seat-slots')) || 4),
        password: value(el(this.doc, 'room-password')) || undefined,
        allowSpectate: (el(this.doc, 'chk-spectate') as HTMLInputElement | null)?.checked ?? true,
        hidden: (el(this.doc, 'chk-hidden') as HTMLInputElement | null)?.checked ?? false,
      });
      return undefined;
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
      if (isHost(this.view)) return this.setStatus('你是房主：要么移交房主，要么关闭房间，不能直接走。');
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
    this.listboxes.attachAll();
  }

  private connCreateFrom(endpoint: Endpoint, input: { gameId: string; roomName: string; seatSlots: number; password?: string; allowSpectate: boolean; hidden: boolean }): void {
    this.connectTo(endpoint, null);
    this.pendingJoin = {
      type: 'roomCreate',
      gameId: input.gameId,
      roomName: input.roomName,
      seatSlots: input.seatSlots,
      password: input.password,
      allowSpectate: input.allowSpectate,
      hidden: input.hidden,
      config: {},
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

  private copyInvite(): void {
    const link = this.inviteUrl();
    const node = el(this.doc, 'invite-url') as HTMLInputElement | null;
    if (node) node.value = link;
    void this.doc.defaultView?.navigator.clipboard?.writeText(link).then(
      () => this.setStatus('邀请链接已复制，发给朋友点开就填好地址和房号'),
      () => this.setStatus(`复制失败，手动拷这条：${link}`),
    );
  }

  private inviteUrl(): string {
    if (!this.view.room || !this.endpoint) return '';
    return inviteLink(this.endpoint.httpOrigin, this.view.room.code, this.view.room.gameId, pathOf(this.endpoint.wsUrl));
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
    const title = el(this.doc, 'room-title');
    const codeChip = el(this.doc, 'room-code-hud');
    if (title && this.view.room) {
      const room = this.view.room;
      const phase = room.phase === 'lobby' ? '等待入座' : room.phase === 'playing' ? '对局中' : '已结束';
      title.textContent = `${room.name} · ${room.gameName} · ${phase}`;
    }
    if (codeChip && this.view.room) codeChip.textContent = this.view.room.code;
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
    };
    for (const seat of this.view.seats) {
      const me = seat.seatId === this.view.mySeatId;
      const classes = ['seat', `seat-${seat.role}`];
      if (seat.ready && seat.role !== 'spectator' && seat.role !== 'ai') classes.push('is-ready');
      if (me) classes.push('is-me');
      if (!seat.connected && seat.role !== 'ai') classes.push('is-offline');
      const icon = seat.role === 'host' ? 'ti-crown' : seat.role === 'ai' ? 'ti-robot' : seat.role === 'spectator' ? 'ti-eye' : seat.ready ? 'ti-circle-check' : 'ti-user';
      pushRow(classes.join(' '), seat.slot, seat.name, this.seatStateText(seat), seatLabel(seat), icon);
    }
    for (const slot of emptySlots(this.view)) {
      pushRow('seat seat-empty', slot, '空位', '等待加入', `${slot} 号位空着`, 'ti-plug');
    }
    const invite = el(this.doc, 'invite-url') as HTMLInputElement | null;
    if (invite && !invite.value) invite.value = this.inviteUrl();
    const countdown = el(this.doc, 'turn-countdown');
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
      startButton.disabled = this.view.phase !== 'lobby' || !blockers.ok;
      startButton.textContent = blockers.tooFew
        ? '人还不够'
        : blockers.unready.length > 0
          ? `等准备：${blockers.unready.join('、')}`
          : '开始对局';
    }
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
    for (const id of ['transfer-target', 'kick-target']) {
      const select = el(this.doc, id) as HTMLSelectElement | null;
      if (!select) continue;
      const candidates = this.view.seats.filter((s) => s.seatId !== this.view.mySeatId && (id === 'kick-target' ? s.role !== 'host' : s.role === 'player'));
      const previous = select.value;
      select.replaceChildren(
        ...candidates.map((s) => {
          const option = this.doc.createElement('option');
          option.value = s.seatId;
          option.textContent = `${s.slot} 号 · ${s.name}`;
          return option;
        }),
      );
      if (candidates.some((s) => s.seatId === previous)) select.value = previous;
    }
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
}

function pathOf(wsUrl: string): string {
  const match = /^wss?:\/\/[^/]+(\/.*)$/.exec(wsUrl);
  return match?.[1] ?? '/ws';
}
