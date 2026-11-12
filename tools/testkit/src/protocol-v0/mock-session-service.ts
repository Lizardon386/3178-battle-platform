import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { rulesHashOf } from './canonical-json.js';
import { FIELD_LIMITS, normalizeFields, validateFieldSpecs, type FieldSpec } from './normalize-config.js';
import { validateJson, type SchemaRule } from './schema-validator.js';
import type { AuthorityToPlatformMessage, Member, PlatformToAuthorityMessage, ProtocolMessage } from './generated/messages.js';
import { MockTransport, type MockClient } from './mock-transport.js';

type AnyMessage = Record<string, any>;
type CatalogEntry = { type: string; from: string; to: string; schema: string; channel: string; scope?: string };
type MemberRecord = {
  memberId: string;
  slot?: number;
  role: 'player' | 'ai' | 'spectator';
  ready: boolean;
  profile: { nick: string; avatar?: string; displayColor?: string };
  connected: boolean;
  options: Record<string, unknown>;
  ticketHash: string;
  gameTicketHash?: string;
  connectionId?: string;
  gameConnectionId?: string;
};
export type GameManifest = {
  id: string;
  name: string;
  version: string;
  requiredCapabilities?: string[];
  lateJoin?: 'spectator' | 'player' | 'deny';
  platformRequirements: {
    protocolVersion: number;
    minPlayers: number;
    maxPlayers: number;
    allowSpectate?: boolean;
    soloFill?: boolean;
  };
  entryPoints: { authority: string; web?: string };
  sessionConfig: { fields: FieldSpec[]; seatOptions?: FieldSpec[] };
  reference: { entry: string };
};
type SessionRecord = {
  id: string;
  code: string;
  name: string;
  gameId: string;
  version: string;
  manifest: GameManifest;
  config: Record<string, unknown>;
  rulesHash: string;
  memberSlots: number;
  spectatorLimit: number;
  password?: string;
  members: MemberRecord[];
  hostMemberId: string;
  state: 'open' | 'closing' | 'closed';
  gameProcess: 'stopped' | 'starting' | 'running' | 'failed' | 'exited';
  authorityEpoch: number;
  revision: number;
  nextMember: number;
  lastGameSequence: number;
  seenActions: Set<string>;
};
export interface AuthorityEndpoint {
  receive(message: PlatformToAuthorityMessage): void;
}

const specDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../protocol/v0');
const messageSchema = JSON.parse(fs.readFileSync(path.join(specDir, 'messages.schema.json'), 'utf8')) as SchemaRule;
const manifestSchema = JSON.parse(fs.readFileSync(path.join(specDir, 'manifest.schema.json'), 'utf8')) as SchemaRule;
const catalog = JSON.parse(fs.readFileSync(path.join(specDir, 'catalog.json'), 'utf8')) as { messages: CatalogEntry[] };
const hashSecret = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const newSecret = (prefix: string) => `${prefix}-${randomBytes(12).toString('hex')}`;

/** 协议语义内存夹具：不监听端口、不启动进程、不继承旧 Engine。 */
export class MockSessionService {
  readonly transport = new MockTransport();
  readonly clients: MockClient[] = [];
  current: SessionRecord | null = null;
  authority: AuthorityEndpoint | null = null;
  authorityStarts = 0;
  private authorityFactory: (() => AuthorityEndpoint) | null = null;
  private readonly games = new Map<string, GameManifest>();
  private readonly handoffs = new Map<string, { memberId: string; expiresAt: number; used: boolean }>();

  useAuthority(factory: () => AuthorityEndpoint): void {
    this.authorityFactory = factory;
  }

  /** 注册清单；config / seatOptions 的声明在这里先做语义校验。 */
  registerGame(input: unknown): GameManifest {
    const manifest = input as GameManifest;
    const errors = validateJson(manifest, manifestSchema, manifestSchema);
    if (errors.length) throw new Error(`manifest 不合法: ${errors[0]}`);
    const configError = validateFieldSpecs(manifest.sessionConfig?.fields, FIELD_LIMITS.fields, 'sessionConfig.fields');
    if (configError) throw new Error(`manifest 不合法: ${configError}`);
    const seatError = validateFieldSpecs(manifest.sessionConfig.seatOptions ?? [], FIELD_LIMITS.seatOptions, 'sessionConfig.seatOptions');
    if (seatError) throw new Error(`manifest 不合法: ${seatError}`);
    this.games.set(`${manifest.id}@${manifest.version}`, manifest);
    return manifest;
  }

  connect(options: { local?: boolean } = {}): MockClient {
    const client = this.transport.connect(options);
    this.clients.push(client);
    return client;
  }

  disconnect(client: MockClient): void {
    if (!client.connected) return;
    this.transport.disconnect(client);
    if (client.channel === 'game') {
      const member = this.current?.members.find((item) => item.gameConnectionId === client.id);
      if (member) member.gameConnectionId = undefined;
      return;
    }
    const member = this.memberFor(client);
    if (!member || member.connectionId !== client.id) return;
    member.connected = false;
    member.connectionId = undefined;
    this.sendAuthority({ type: 'memberLeave', memberId: member.memberId, reason: 'disconnected', authorityEpoch: this.current!.authorityEpoch, revision: this.current!.revision });
    this.bump();
  }

  receive(client: MockClient, input: unknown): void {
    if (!client.connected) return;
    let message: AnyMessage;
    try { message = typeof input === 'string' ? JSON.parse(input) : input as AnyMessage; }
    catch { this.error(client, 'BADMSG', '消息不是合法 JSON'); return; }
    const entry = catalog.messages.find((item) => item.from === 'client' && item.to === 'platform' && item.type === message?.type);
    if (!entry) { this.error(client, 'BADMSG', '未知客户端消息'); return; }
    const shapeErrors = validateJson(message, { $ref: `#/$defs/${entry.schema}` }, messageSchema);
    if (shapeErrors.length) { this.error(client, 'BADMSG', shapeErrors[0]!); return; }
    const requestId = typeof message.requestId === 'string' ? message.requestId : undefined;
    if (entry.scope === 'local' && !client.local) {
      this.error(client, 'FORBIDDEN', '该命令只允许本机控制面', requestId); return;
    }
    if (entry.channel === 'game' && client.channel !== 'game' && message.type !== 'gameAuth') {
      this.error(client, 'FORBIDDEN', '游戏消息只能走游戏通道', requestId); return;
    }
    if (entry.channel === 'session' && client.channel !== 'session') {
      this.error(client, 'FORBIDDEN', '管理消息只能走会话通道', requestId); return;
    }
    switch (message.type) {
      case 'hello': this.send(client, { type: 'welcome', protocolVersion: 0, supported: ['resume', 'ready', 'start', 'game.handoff', 'game.sync', 'session.probe', 'recover'], serverVersion: '0.1.0' }); break;
      case 'sessionProbe': this.probe(client, message); break;
      case 'sessionCreate': this.createSession(client, message); break;
      case 'sessionJoin': this.joinSession(client, message); break;
      case 'resume': this.resume(client, message); break;
      case 'setReady': this.setReady(client, message); break;
      case 'setConfig': this.setConfig(client, message); break;
      case 'setSeatOptions': this.setSeatOptions(client, message); break;
      case 'startGame': this.startGame(client); break;
      case 'recoverGame': this.recoverGame(client); break;
      case 'gameHandoff': this.gameHandoff(client); break;
      case 'gameAuth': this.gameAuth(client, message); break;
      case 'game': this.forwardGame(client, message); break;
      case 'sync': this.sync(client); break;
      case 'chat': this.chat(client, message); break;
      case 'leave': this.leave(client, 'left'); break;
      case 'kick': this.kick(client, message); break;
      case 'transferHost': this.transferHost(client, message); break;
      case 'closeSession': this.closeSession(client); break;
      case 'ping': this.send(client, { type: 'pong', nonce: message.nonce }); break;
    }
  }

  receiveFromAuthority(input: AuthorityToPlatformMessage): void {
    const message = input as AnyMessage;
    const entry = catalog.messages.find((item) => item.from === 'authority' && item.to === 'platform' && item.type === message.type);
    if (!entry) throw new Error(`unknown authority message ${message.type}`);
    const errors = validateJson(message, { $ref: `#/$defs/${entry.schema}` }, messageSchema);
    if (errors.length) throw new Error(errors.join('\n'));
    const session = this.current;
    if (!session || message.authorityEpoch !== session.authorityEpoch) throw new Error('stale authority epoch');
    switch (message.type) {
      case 'authorityReady':
        if (session.gameProcess !== 'starting') throw new Error('authorityReady without starting');
        session.gameProcess = 'running';
        this.bump();
        break;
      case 'deliver':
        session.lastGameSequence = message.gameSequence;
        for (const item of message.items as { to: string | 'all'; payload: unknown; viewRevision?: number }[]) {
          const gameMessage = { type: 'game', payload: item.payload, authorityEpoch: session.authorityEpoch, gameSequence: message.gameSequence, ...(item.viewRevision === undefined ? {} : { viewRevision: item.viewRevision }) };
          if (item.to === 'all') this.broadcastGame(gameMessage);
          else this.sendToMemberGame(item.to, gameMessage);
        }
        break;
      case 'roundClosed':
        this.broadcastGame({ type: 'game', payload: message.payload, authorityEpoch: session.authorityEpoch, gameSequence: session.lastGameSequence });
        break;
      case 'authorityError':
        session.gameProcess = 'failed';
        this.bump();
        break;
      case 'pong': break;
    }
  }

  private probe(client: MockClient, message: AnyMessage): void {
    const session = this.current;
    if (!session || session.state !== 'open') { this.error(client, 'NOROOM', '会话不存在或已关闭'); return; }
    this.send(client, {
      type: 'sessionPreview',
      code: session.code,
      name: session.name,
      gameId: session.gameId,
      version: session.version,
      config: session.config,
      rulesHash: session.rulesHash,
      memberSlots: session.memberSlots,
      spectatorLimit: session.spectatorLimit,
      requiredCapabilities: session.manifest.requiredCapabilities ?? [],
      lateJoin: session.manifest.lateJoin ?? 'spectator',
      manifest: {
        sessionConfig: session.manifest.sessionConfig,
        reference: session.manifest.reference,
        requiredCapabilities: session.manifest.requiredCapabilities ?? [],
        lateJoin: session.manifest.lateJoin ?? 'spectator',
      },
      manifestHash: rulesHashOf(session.manifest),
    });
  }

  private createSession(client: MockClient, message: AnyMessage): void {
    if (this.current?.state === 'open') { this.error(client, 'PHASE', '已有进行中的会话'); return; }
    const manifest = this.games.get(`${message.gameId}@${message.version}`);
    if (!manifest) { this.error(client, 'UNKNOWN_GAME', '游戏或版本未注册'); return; }
    const config = normalizeFields(manifest.sessionConfig.fields, message.config);
    if (!config.ok) { this.error(client, 'CONFIG', config.error); return; }
    const options = normalizeFields(manifest.sessionConfig.seatOptions ?? [], {}, 'player');
    if (!options.ok) { this.error(client, 'CONFIG', options.error); return; }
    const ticket = newSecret('ticket');
    const member: MemberRecord = { memberId: 'm1', slot: 1, role: 'player', ready: false, profile: message.profile, connected: true, options: options.value, ticketHash: hashSecret(ticket), connectionId: client.id };
    this.current = {
      id: 'sess-893F', code: '893F', name: message.roomName, gameId: message.gameId, version: message.version, manifest,
      config: config.value, rulesHash: rulesHashOf(config.value), memberSlots: message.memberSlots,
      spectatorLimit: message.spectatorLimit ?? 8, password: message.password, members: [member],
      hostMemberId: 'm1', state: 'open', gameProcess: 'stopped', authorityEpoch: 0, revision: 0,
      nextMember: 2, lastGameSequence: 0, seenActions: new Set(),
    };
    client.memberId = 'm1'; client.ticket = ticket;
    this.send(client, { type: 'seatGranted', memberId: 'm1', ticket, sessionCode: '893F', sessionId: 'sess-893F', profile: message.profile });
    this.bump();
  }

  private joinSession(client: MockClient, message: AnyMessage): void {
    const session = this.current;
    if (!session || session.state !== 'open') { this.error(client, 'NOROOM', '会话不存在'); return; }
    if (message.gameId !== session.gameId || message.version !== session.version) { this.error(client, 'VERSION', '游戏版本不符'); return; }
    if (message.rulesHash !== session.rulesHash) { this.error(client, 'RULES', '玩法参数摘要不符'); return; }
    if (session.password && message.credentials.password !== session.password) { this.error(client, 'PASSWORD', '密码错误'); return; }
    const role = (message.role ?? 'player') as MemberRecord['role'];
    if (role === 'spectator') {
      const spectators = session.members.filter((member) => member.role === 'spectator').length;
      if (spectators >= session.spectatorLimit) { this.error(client, 'FULL', '观战席已满'); return; }
    } else {
      const used = new Set(session.members.map((member) => member.slot).filter((slot): slot is number => slot !== undefined));
      if (used.size >= session.memberSlots) { this.error(client, 'FULL', '席位已满'); return; }
    }
    const options = normalizeFields(session.manifest.sessionConfig.seatOptions ?? [], {}, role);
    if (!options.ok) { this.error(client, 'CONFIG', options.error); return; }
    const slot = role === 'spectator' ? undefined : this.firstFreeSlot(session);
    const memberId = `m${session.nextMember}`;
    session.nextMember += 1;
    const ticket = newSecret('ticket');
    const member: MemberRecord = { memberId, ...(slot === undefined ? {} : { slot }), role, ready: false, profile: message.profile, connected: true, options: options.value, ticketHash: hashSecret(ticket), connectionId: client.id };
    session.members.push(member);
    client.memberId = memberId; client.ticket = ticket;
    this.send(client, { type: 'seatGranted', memberId, ticket, sessionCode: session.code, sessionId: session.id, profile: message.profile });
    this.sendAuthority({ type: 'memberJoin', member: this.publicMember(member), authorityEpoch: session.authorityEpoch, revision: session.revision });
    this.bump();
  }

  private resume(client: MockClient, message: AnyMessage): void {
    const session = this.current;
    if (!session || session.id !== message.sessionId) { this.error(client, 'NOROOM', '会话不存在'); return; }
    const member = session.members.find((item) => item.ticketHash === hashSecret(message.ticket));
    if (!member) { this.error(client, 'SEATLOST', '票据无效或座位已失效'); return; }
    client.memberId = member.memberId; client.ticket = message.ticket; client.channel = 'session';
    member.connected = true; member.connectionId = client.id;
    if (message.profile) member.profile = message.profile;
    this.send(client, { type: 'seatGranted', memberId: member.memberId, ticket: message.ticket, sessionCode: session.code, sessionId: session.id, profile: member.profile });
    this.sendAuthority({ type: 'memberResume', memberId: member.memberId, profile: member.profile, authorityEpoch: session.authorityEpoch, revision: session.revision });
    this.bump();
  }

  private setReady(client: MockClient, message: AnyMessage): void {
    const member = this.requireMember(client); if (!member) return;
    if (member.role !== 'player') { this.error(client, 'PHASE', '电脑与观战不使用准备标记'); return; }
    if (this.current!.gameProcess !== 'stopped') { this.error(client, 'PHASE', '开始后不能修改准备状态'); return; }
    member.ready = message.ready;
    this.sendAuthority({ type: 'memberUpdate', memberId: member.memberId, ready: member.ready, profile: member.profile, options: member.options, authorityEpoch: this.current!.authorityEpoch, revision: this.current!.revision });
    this.bump();
  }

  private setConfig(client: MockClient, message: AnyMessage): void {
    const session = this.current; if (!this.requireHost(client) || !session) return;
    if (session.gameProcess !== 'stopped') { this.error(client, 'PHASE', '开始后不能修改玩法参数'); return; }
    const config = normalizeFields(session.manifest.sessionConfig.fields, message.config);
    if (!config.ok) { this.error(client, 'CONFIG', config.error); return; }
    session.config = config.value;
    session.rulesHash = rulesHashOf(session.config);
    for (const member of session.members) if (member.role === 'player') member.ready = false;
    this.bump();
  }

  private setSeatOptions(client: MockClient, message: AnyMessage): void {
    const session = this.current; if (!this.requireHost(client) || !session) return;
    if (session.gameProcess !== 'stopped') { this.error(client, 'PHASE', '开始后不能修改座位选项'); return; }
    const member = session.members.find((item) => item.memberId === message.memberId);
    if (!member) { this.error(client, 'NOSEAT', '目标成员不存在'); return; }
    const options = normalizeFields(session.manifest.sessionConfig.seatOptions ?? [], message.options, member.role);
    if (!options.ok) { this.error(client, 'CONFIG', options.error); return; }
    member.options = options.value;
    this.sendAuthority({ type: 'memberUpdate', memberId: member.memberId, ready: member.ready, profile: member.profile, options: member.options, authorityEpoch: session.authorityEpoch, revision: session.revision });
    this.bump();
  }

  private startGame(client: MockClient): void {
    const session = this.current; if (!this.requireHost(client) || !session) return;
    if (session.gameProcess !== 'stopped') { this.error(client, 'PHASE', '游戏进程已经开始'); return; }
    const humans = session.members.filter((member) => member.role === 'player');
    if (!humans.length || humans.some((member) => !member.connected || !member.ready)) {
      this.error(client, 'NOTREADY', '至少需要一名真人，且所有已连接真人已准备'); return;
    }
    this.launchAuthority(session);
  }

  private recoverGame(client: MockClient): void {
    const session = this.current; if (!this.requireHost(client) || !session) return;
    if (session.gameProcess !== 'failed' && session.gameProcess !== 'exited') {
      this.error(client, 'PHASE', '只有失败或已退出的权威可以恢复'); return;
    }
    this.launchAuthority(session);
  }

  private launchAuthority(session: SessionRecord): void {
    if (!this.authorityFactory) { this.error(this.clients.find((client) => client.memberId === session.hostMemberId) ?? this.clients[0]!, 'GAMEFAILED', '没有可用的权威启动器'); return; }
    session.authorityEpoch += 1;
    this.revokeGameConnections();
    session.gameProcess = 'starting';
    this.authorityStarts += 1;
    this.authority = this.authorityFactory();
    this.sendAuthority({
      type: 'start', sessionId: session.id, gameId: session.gameId, version: session.version, sessionCode: session.code,
      authorityEpoch: session.authorityEpoch, sessionConfig: session.config,
      members: session.members.map((member) => this.publicMember(member)),
      hostMemberId: session.hostMemberId, revision: session.revision,
    });
    this.bump();
  }

  private gameHandoff(client: MockClient): void {
    const member = this.requireMember(client); if (!member) return;
    if (this.current?.gameProcess !== 'running') { this.error(client, 'PHASE', '游戏权威尚未就绪'); return; }
    const handoffCode = newSecret('handoff');
    this.handoffs.set(hashSecret(handoffCode), { memberId: member.memberId, expiresAt: Date.now() + 30_000, used: false });
    this.send(client, { type: 'gameHandoff', url: `http://game.local/#c=${handoffCode}`, handoffCode, expiresAt: Date.now() + 30_000 });
  }

  private gameAuth(client: MockClient, message: AnyMessage): void {
    const session = this.current;
    if (!session) { this.error(client, 'NOROOM', '会话不存在'); return; }
    let memberId: string | undefined;
    if (message.handoffCode) {
      const handoff = this.handoffs.get(hashSecret(message.handoffCode));
      if (!handoff || handoff.used || handoff.expiresAt < Date.now()) { this.error(client, 'HANDOFF', '交接码无效、过期或已使用'); return; }
      handoff.used = true;
      memberId = handoff.memberId;
    } else {
      const member = session.members.find((item) => item.gameTicketHash === hashSecret(message.gameTicket));
      if (!member) { this.error(client, 'HANDOFF', '游戏凭证无效'); return; }
      memberId = member.memberId;
    }
    const member = session.members.find((item) => item.memberId === memberId);
    if (!member) { this.error(client, 'SEATLOST', '成员已失效'); return; }
    this.revokeGameConnection(member);
    const gameTicket = newSecret('game-ticket');
    member.gameTicketHash = hashSecret(gameTicket);
    member.gameConnectionId = client.id;
    client.channel = 'game'; client.memberId = member.memberId; client.gameTicket = gameTicket;
    this.send(client, { type: 'gameGranted', gameTicket, sessionId: session.id, memberId: member.memberId, authorityEpoch: session.authorityEpoch });
  }

  private forwardGame(client: MockClient, message: AnyMessage): void {
    const member = this.requireGameMember(client); if (!member) return;
    const session = this.current!;
    if (session.gameProcess !== 'running') { this.error(client, 'PHASE', '游戏权威尚未就绪'); return; }
    if (session.seenActions.has(message.actionId)) return;
    session.seenActions.add(message.actionId);
    this.sendAuthority({ type: 'deliver', fromMemberId: member.memberId, actionId: message.actionId, payload: message.payload, authorityEpoch: session.authorityEpoch, revision: session.revision });
  }

  private sync(client: MockClient): void {
    const member = this.requireGameMember(client); if (!member) return;
    if (this.current?.gameProcess !== 'running') { this.error(client, 'PHASE', '游戏权威尚未就绪'); return; }
    this.sendAuthority({ type: 'sync', memberId: member.memberId, authorityEpoch: this.current.authorityEpoch });
  }

  private chat(client: MockClient, message: AnyMessage): void {
    const member = this.requireMember(client); if (!member) return;
    this.broadcastSession({ type: 'chat', fromMemberId: member.memberId, profile: member.profile, text: message.text, sentAt: Date.now() });
  }

  private leave(client: MockClient, reason: 'left' | 'kicked'): void {
    const member = this.requireMember(client); if (!member) return;
    if (member.memberId === this.current!.hostMemberId) { this.error(client, 'HOSTONLY', '房主离开前先移交或关闭会话'); return; }
    this.removeMember(member, reason);
    client.memberId = undefined; client.ticket = undefined;
  }

  private kick(client: MockClient, message: AnyMessage): void {
    if (!this.requireHost(client)) return;
    const member = this.current!.members.find((item) => item.memberId === message.targetMemberId);
    if (!member || member.memberId === this.current!.hostMemberId) { this.error(client, 'NOSEAT', '目标不存在或不能请出房主'); return; }
    this.removeMember(member, 'kicked');
    this.disconnectMemberClients(member);
  }

  private transferHost(client: MockClient, message: AnyMessage): void {
    const session = this.current; if (!this.requireHost(client) || !session) return;
    const target = session.members.find((item) => item.memberId === message.targetMemberId && item.role === 'player');
    if (!target) { this.error(client, 'NOSEAT', '接任者必须是真人玩家'); return; }
    session.hostMemberId = target.memberId;
    this.sendAuthority({ type: 'hostChanged', hostMemberId: target.memberId, authorityEpoch: session.authorityEpoch, revision: session.revision });
    this.bump();
  }

  private closeSession(client: MockClient): void {
    const session = this.current; if (!this.requireHost(client) || !session) return;
    this.sendAuthority({ type: 'closeSession', reason: 'host closed', authorityEpoch: session.authorityEpoch });
    session.state = 'closed';
    if (session.gameProcess !== 'stopped') session.gameProcess = 'exited';
    this.revokeGameConnections();
    this.bump();
  }

  private removeMember(member: MemberRecord, reason: 'left' | 'kicked' | 'expired'): void {
    const session = this.current!;
    this.sendAuthority({ type: 'memberLeave', memberId: member.memberId, reason, authorityEpoch: session.authorityEpoch, revision: session.revision });
    this.revokeGameConnection(member);
    session.members = session.members.filter((item) => item.memberId !== member.memberId);
    this.bump();
  }

  private firstFreeSlot(session: SessionRecord): number {
    const used = new Set(session.members.map((member) => member.slot).filter((slot): slot is number => slot !== undefined));
    for (let slot = 1; slot <= session.memberSlots; slot += 1) if (!used.has(slot)) return slot;
    throw new Error('no free slot');
  }

  private requireMember(client: MockClient): MemberRecord | null {
    const member = this.memberFor(client);
    if (!member || member.connectionId !== client.id) { this.error(client, 'NOSEAT', '当前连接没有有效成员'); return null; }
    return member;
  }

  private requireGameMember(client: MockClient): MemberRecord | null {
    const member = this.current?.members.find((item) => item.memberId === client.memberId);
    if (!member || client.channel !== 'game' || member.gameConnectionId !== client.id) {
      this.error(client, 'FORBIDDEN', '需要有效的游戏连接'); return null;
    }
    return member;
  }

  private requireHost(client: MockClient): boolean {
    const member = this.requireMember(client);
    if (!member) return false;
    if (member.memberId !== this.current?.hostMemberId) { this.error(client, 'NOTHOST', '只有房主可以执行'); return false; }
    return true;
  }

  private memberFor(client: MockClient): MemberRecord | undefined {
    return this.current?.members.find((member) => member.memberId === client.memberId);
  }

  private publicMember(member: MemberRecord): Member {
    return {
      memberId: member.memberId,
      ...(member.slot === undefined ? {} : { slot: member.slot }),
      role: member.role,
      ready: member.ready,
      profile: member.profile,
      connected: member.connected,
      options: member.options,
    };
  }

  private revokeGameConnection(member: MemberRecord): void {
    if (!member.gameConnectionId) return;
    const client = this.clients.find((item) => item.id === member.gameConnectionId);
    if (client) this.transport.disconnect(client);
    member.gameConnectionId = undefined;
    member.gameTicketHash = undefined;
  }

  private revokeGameConnections(): void {
    for (const member of this.current?.members ?? []) this.revokeGameConnection(member);
  }

  private disconnectMemberClients(member: MemberRecord): void {
    for (const client of this.clients) {
      if (client.memberId === member.memberId) {
        this.transport.disconnect(client);
        client.memberId = undefined; client.ticket = undefined; client.gameTicket = undefined;
      }
    }
  }

  private bump(): void {
    if (!this.current) return;
    this.current.revision += 1;
    this.broadcastSession(this.snapshot());
  }

  private snapshot(): AnyMessage {
    const session = this.current!;
    return {
      type: 'sessionState',
      sessionId: session.id,
      code: session.code,
      name: session.name,
      gameId: session.gameId,
      version: session.version,
      config: session.config,
      rulesHash: session.rulesHash,
      memberSlots: session.memberSlots,
      spectatorLimit: session.spectatorLimit,
      members: session.members.map((member) => this.publicMember(member)),
      hostMemberId: session.hostMemberId,
      state: session.state,
      gameProcess: session.gameProcess,
      authorityEpoch: session.authorityEpoch,
      revision: session.revision,
    };
  }

  private broadcastSession(message: AnyMessage): void {
    for (const client of this.clients.filter((client) => client.connected && client.channel === 'session')) this.send(client, message);
  }

  private broadcastGame(message: AnyMessage): void {
    for (const client of this.clients.filter((client) => client.connected && client.channel === 'game')) this.send(client, message);
  }

  private sendToMemberGame(memberId: string, message: AnyMessage): void {
    const member = this.current?.members.find((item) => item.memberId === memberId);
    if (!member?.gameConnectionId) return;
    const client = this.clients.find((item) => item.id === member.gameConnectionId && item.connected);
    if (client) this.send(client, message);
  }

  private send(client: MockClient, message: AnyMessage): void {
    const entry = catalog.messages.find((item) => item.from === 'platform' && item.to === 'client' && item.type === message.type);
    if (!entry) throw new Error(`unknown platform message ${message.type}`);
    const errors = validateJson(message, { $ref: `#/$defs/${entry.schema}` }, messageSchema);
    if (errors.length) throw new Error(errors.join('\n'));
    this.transport.deliver(client, message as ProtocolMessage);
  }

  private sendAuthority(message: AnyMessage): void {
    if (!this.authority) return;
    if (message.type !== 'start' && this.current?.gameProcess !== 'running') return;
    const entry = catalog.messages.find((item) => item.from === 'platform' && item.to === 'authority' && item.type === message.type);
    if (!entry) throw new Error(`unknown IPC message ${message.type}`);
    const errors = validateJson(message, { $ref: `#/$defs/${entry.schema}` }, messageSchema);
    if (errors.length) throw new Error(errors.join('\n'));
    this.authority.receive(message as PlatformToAuthorityMessage);
  }

  private error(client: MockClient, code: string, text: string, requestId?: string): void {
    this.send(client, { type: 'error', code, text, ...(requestId === undefined ? {} : { requestId }) });
  }
}
