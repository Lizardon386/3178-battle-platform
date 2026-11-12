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
type CatalogEntry = { type: string; from: string; to: string; schema: string; channel: string };
type MemberRecord = Member & { ticketHash: string; gameTicketHash?: string; connectionId?: string };
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
  gameId: string;
  version: string;
  manifest: GameManifest;
  config: Record<string, unknown>;
  rulesHash: string;
  memberSlots: number;
  password?: string;
  members: MemberRecord[];
  hostSeatId: number;
  state: 'open' | 'closed';
  gameProcess: 'stopped' | 'starting' | 'running' | 'failed' | 'exited';
  revision: number;
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
  private readonly handoffs = new Map<string, { seatId: number; expiresAt: number; used: boolean }>();

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

  connect(): MockClient {
    const client = this.transport.connect();
    this.clients.push(client);
    return client;
  }

  disconnect(client: MockClient): void {
    if (!client.connected) return;
    this.transport.disconnect(client);
    const member = this.memberFor(client);
    if (!member || member.connectionId !== client.id) return;
    member.connected = false;
    member.connectionId = undefined;
    this.sendAuthority({ type: 'memberLeave', seatId: member.seatId, reason: 'disconnected', revision: this.current!.revision });
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
    if (client.channel === 'game' && !['game', 'ping'].includes(message.type)) {
      this.error(client, 'FORBIDDEN', '游戏凭证不能调用平台管理动作'); return;
    }
    switch (message.type) {
      case 'hello': this.send(client, { type: 'welcome', protocolVersion: 0, supported: ['resume', 'ready', 'start', 'game.handoff'], serverVersion: '0.1.0' }); break;
      case 'sessionCreate': this.createSession(client, message); break;
      case 'sessionJoin': this.joinSession(client, message); break;
      case 'resume': this.resume(client, message); break;
      case 'setReady': this.setReady(client, message); break;
      case 'setConfig': this.setConfig(client, message); break;
      case 'setSeatOptions': this.setSeatOptions(client, message); break;
      case 'startGame': this.startGame(client); break;
      case 'gameHandoff': this.gameHandoff(client); break;
      case 'gameAuth': this.gameAuth(client, message); break;
      case 'game': this.forwardGame(client, message); break;
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
    switch (message.type) {
      case 'authorityReady':
        if (this.current?.gameProcess !== 'starting') throw new Error('authorityReady without starting');
        this.current.gameProcess = 'running';
        this.bump();
        break;
      case 'deliver':
        for (const item of message.items as { to: number | 'all'; payload: unknown }[]) {
          if (item.to === 'all') this.broadcastGame({ type: 'game', payload: item.payload });
          else for (const client of this.clients.filter((client) => client.connected && client.seatId === item.to)) this.send(client, { type: 'game', payload: item.payload });
        }
        break;
      case 'roundClosed': this.broadcastGame({ type: 'game', payload: message.payload }); break;
      case 'authorityError':
        if (this.current) { this.current.gameProcess = 'failed'; this.bump(); }
        break;
      case 'pong': break;
    }
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
    const member: MemberRecord = { seatId: 1, kind: 'player', ready: false, profile: message.profile, connected: true, options: options.value, ticketHash: hashSecret(ticket), connectionId: client.id };
    this.current = {
      id: 'sess-893F', code: '893F', gameId: message.gameId, version: message.version, manifest,
      config: config.value, rulesHash: rulesHashOf(config.value), memberSlots: message.memberSlots,
      password: message.password, members: [member], hostSeatId: 1, state: 'open', gameProcess: 'stopped', revision: 0,
    };
    client.seatId = 1; client.ticket = ticket;
    this.send(client, { type: 'seatGranted', seatId: 1, ticket, sessionCode: '893F', profile: message.profile });
    this.bump();
  }

  private joinSession(client: MockClient, message: AnyMessage): void {
    const session = this.current;
    if (!session || session.state !== 'open') { this.error(client, 'NOROOM', '会话不存在'); return; }
    if (message.gameId !== session.gameId || message.version !== session.version) { this.error(client, 'VERSION', '游戏版本不符'); return; }
    if (message.rulesHash !== session.rulesHash) { this.error(client, 'RULES', '玩法参数摘要不符'); return; }
    if (session.password && message.credentials.password !== session.password) { this.error(client, 'PASSWORD', '密码错误'); return; }
    if (session.members.length >= session.memberSlots) { this.error(client, 'FULL', '席位已满'); return; }
    const options = normalizeFields(session.manifest.sessionConfig.seatOptions ?? [], {}, 'player');
    if (!options.ok) { this.error(client, 'CONFIG', options.error); return; }
    const seatId = session.members.reduce((max, member) => Math.max(max, member.seatId), 0) + 1;
    const ticket = newSecret('ticket');
    const member: MemberRecord = { seatId, kind: 'player', ready: false, profile: message.profile, connected: true, options: options.value, ticketHash: hashSecret(ticket), connectionId: client.id };
    session.members.push(member);
    client.seatId = seatId; client.ticket = ticket;
    this.send(client, { type: 'seatGranted', seatId, ticket, sessionCode: session.code, profile: message.profile });
    this.sendAuthority({ type: 'memberJoin', member: this.publicMember(member), revision: session.revision });
    this.bump();
  }

  private resume(client: MockClient, message: AnyMessage): void {
    const session = this.current;
    if (!session || session.code !== message.code) { this.error(client, 'NOROOM', '会话不存在'); return; }
    const member = session.members.find((member) => member.ticketHash === hashSecret(message.ticket));
    if (!member) { this.error(client, 'SEATLOST', '票据无效或座位已失效'); return; }
    client.seatId = member.seatId; client.ticket = message.ticket; client.channel = 'session';
    member.connected = true; member.connectionId = client.id;
    if (message.profile) member.profile = message.profile;
    this.send(client, { type: 'seatGranted', seatId: member.seatId, ticket: message.ticket, sessionCode: session.code, profile: member.profile });
    this.sendAuthority({ type: 'memberResume', seatId: member.seatId, profile: member.profile, revision: session.revision });
    this.bump();
  }

  private setReady(client: MockClient, message: AnyMessage): void {
    const member = this.requireSeat(client); if (!member) return;
    if (member.kind !== 'player') { this.error(client, 'PHASE', '电脑与观战不使用准备标记'); return; }
    member.ready = message.ready;
    this.sendAuthority({ type: 'memberUpdate', seatId: member.seatId, ready: member.ready, profile: member.profile, options: member.options, revision: this.current!.revision });
    this.bump();
  }

  private setConfig(client: MockClient, message: AnyMessage): void {
    const session = this.current; if (!this.requireHost(client) || !session) return;
    if (session.gameProcess !== 'stopped') { this.error(client, 'PHASE', '开始后不能修改玩法参数'); return; }
    const config = normalizeFields(session.manifest.sessionConfig.fields, message.config);
    if (!config.ok) { this.error(client, 'CONFIG', config.error); return; }
    session.config = config.value;
    session.rulesHash = rulesHashOf(session.config);
    for (const member of session.members) if (member.kind === 'player') member.ready = false;
    this.bump();
  }

  private setSeatOptions(client: MockClient, message: AnyMessage): void {
    const session = this.current; if (!this.requireHost(client) || !session) return;
    if (session.gameProcess !== 'stopped') { this.error(client, 'PHASE', '开始后不能修改座位选项'); return; }
    const member = session.members.find((member) => member.seatId === message.seatId);
    if (!member) { this.error(client, 'NOSEAT', '目标席位不存在'); return; }
    const options = normalizeFields(session.manifest.sessionConfig.seatOptions ?? [], message.options, member.kind);
    if (!options.ok) { this.error(client, 'CONFIG', options.error); return; }
    member.options = options.value;
    this.bump();
  }

  private startGame(client: MockClient): void {
    const session = this.current; if (!this.requireHost(client) || !session) return;
    if (session.gameProcess !== 'stopped') { this.error(client, 'PHASE', '游戏进程已经开始'); return; }
    const humans = session.members.filter((member) => member.kind === 'player');
    if (!humans.length || humans.some((member) => !member.connected || !member.ready)) {
      this.error(client, 'NOTREADY', '至少需要一名真人，且所有已连接真人已准备'); return;
    }
    if (!this.authorityFactory) { this.error(client, 'GAMEFAILED', '没有可用的权威启动器'); return; }
    session.gameProcess = 'starting';
    this.authorityStarts += 1;
    this.authority = this.authorityFactory();
    this.sendAuthority({
      type: 'start', gameId: session.gameId, version: session.version, sessionCode: session.code,
      sessionConfig: session.config, members: session.members.map((member) => this.publicMember(member)),
      hostSeatId: session.hostSeatId, revision: session.revision,
    });
    this.bump();
  }

  private gameHandoff(client: MockClient): void {
    const member = this.requireSeat(client); if (!member) return;
    const handoffCode = newSecret('handoff');
    this.handoffs.set(handoffCode, { seatId: member.seatId, expiresAt: Date.now() + 30_000, used: false });
    this.send(client, { type: 'gameHandoff', url: `http://game.local/#c=${handoffCode}`, handoffCode, expiresAt: Date.now() + 30_000 });
  }

  private gameAuth(client: MockClient, message: AnyMessage): void {
    const session = this.current;
    if (!session) { this.error(client, 'NOROOM', '会话不存在'); return; }
    let seatId: number | undefined;
    let reconnect = false;
    if (message.handoffCode) {
      const handoff = this.handoffs.get(message.handoffCode);
      if (!handoff || handoff.used || handoff.expiresAt < Date.now()) { this.error(client, 'HANDOFF', '交接码无效、过期或已使用'); return; }
      handoff.used = true;
      seatId = handoff.seatId;
    } else {
      const member = session.members.find((member) => member.gameTicketHash === hashSecret(message.gameTicket));
      if (!member) { this.error(client, 'HANDOFF', '游戏凭证无效'); return; }
      seatId = member.seatId;
      reconnect = true;
    }
    const member = session.members.find((member) => member.seatId === seatId);
    if (!member) { this.error(client, 'SEATLOST', '座位已失效'); return; }
    const gameTicket = newSecret('game-ticket');
    member.gameTicketHash = hashSecret(gameTicket);
    client.channel = 'game'; client.seatId = member.seatId; client.gameTicket = gameTicket;
    this.send(client, { type: 'gameGranted', gameTicket, sessionId: session.id, seatId: member.seatId });
    if (reconnect) this.sendAuthority({ type: 'memberResume', seatId: member.seatId, profile: member.profile, revision: session.revision });
  }

  private forwardGame(client: MockClient, message: AnyMessage): void {
    const member = this.requireSeat(client); if (!member) return;
    if (this.current?.gameProcess !== 'running' || !this.authority) { this.error(client, 'PHASE', '游戏权威尚未就绪'); return; }
    this.sendAuthority({ type: 'deliver', fromSeat: member.seatId, payload: message.payload, revision: this.current.revision });
  }

  private chat(client: MockClient, message: AnyMessage): void {
    const member = this.requireSeat(client); if (!member) return;
    this.broadcastSession({ type: 'chat', fromSeat: member.seatId, profile: member.profile, text: message.text, sentAt: Date.now() });
  }

  private leave(client: MockClient, reason: 'left' | 'kicked'): void {
    const member = this.requireSeat(client); if (!member) return;
    this.removeMember(member, reason);
    client.seatId = undefined; client.ticket = undefined;
  }

  private kick(client: MockClient, message: AnyMessage): void {
    if (!this.requireHost(client)) return;
    const member = this.current!.members.find((member) => member.seatId === message.targetSeat);
    if (!member || member.seatId === this.current!.hostSeatId) { this.error(client, 'NOSEAT', '目标不存在或不能请出房主'); return; }
    this.removeMember(member, 'kicked');
    for (const other of this.clients.filter((client) => client.seatId === member.seatId)) { other.seatId = undefined; other.ticket = undefined; }
  }

  private transferHost(client: MockClient, message: AnyMessage): void {
    const session = this.current; if (!this.requireHost(client) || !session) return;
    const target = session.members.find((member) => member.seatId === message.targetSeat && member.kind === 'player');
    if (!target) { this.error(client, 'NOSEAT', '接任者必须是真人玩家'); return; }
    session.hostSeatId = target.seatId;
    this.sendAuthority({ type: 'hostChanged', hostSeatId: target.seatId, revision: session.revision });
    this.bump();
  }

  private closeSession(client: MockClient): void {
    const session = this.current; if (!this.requireHost(client) || !session) return;
    this.sendAuthority({ type: 'closeSession', reason: 'host closed' });
    session.state = 'closed';
    if (session.gameProcess !== 'stopped') session.gameProcess = 'exited';
    this.bump();
  }

  private removeMember(member: MemberRecord, reason: 'left' | 'kicked'): void {
    const session = this.current!;
    this.sendAuthority({ type: 'memberLeave', seatId: member.seatId, reason, revision: session.revision });
    session.members = session.members.filter((item) => item.seatId !== member.seatId);
    this.bump();
  }

  private requireSeat(client: MockClient): MemberRecord | null {
    const member = this.memberFor(client);
    if (!member) { this.error(client, 'NOSEAT', '当前连接没有座位'); return null; }
    return member;
  }

  private requireHost(client: MockClient): boolean {
    const member = this.memberFor(client);
    if (!member) { this.error(client, 'NOSEAT', '当前连接没有座位'); return false; }
    if (member.seatId !== this.current?.hostSeatId) { this.error(client, 'NOTHOST', '只有房主可以执行'); return false; }
    return true;
  }

  private memberFor(client: MockClient): MemberRecord | undefined {
    return this.current?.members.find((member) => member.seatId === client.seatId);
  }

  private publicMember(member: MemberRecord): Member {
    return { seatId: member.seatId, kind: member.kind, ready: member.ready, profile: member.profile, connected: member.connected, options: member.options };
  }

  private bump(): void {
    if (!this.current) return;
    this.current.revision += 1;
    this.broadcastSession(this.snapshot());
  }

  private snapshot(): ProtocolMessage {
    const session = this.current!;
    return {
      type: 'sessionState', sessionId: session.id, code: session.code,
      members: session.members.map((member) => this.publicMember(member)), hostSeatId: session.hostSeatId,
      state: session.state, gameProcess: session.gameProcess, revision: session.revision,
    };
  }

  private broadcastSession(message: ProtocolMessage): void {
    for (const client of this.clients.filter((client) => client.connected && client.channel === 'session')) this.send(client, message);
  }

  private broadcastGame(message: ProtocolMessage): void {
    for (const client of this.clients.filter((client) => client.connected && client.seatId !== undefined)) this.send(client, message);
  }

  private send(client: MockClient, message: ProtocolMessage): void {
    const entry = catalog.messages.find((item) => item.from === 'platform' && item.to === 'client' && item.type === message.type);
    if (!entry) throw new Error(`unknown platform message ${message.type}`);
    const errors = validateJson(message, { $ref: `#/$defs/${entry.schema}` }, messageSchema);
    if (errors.length) throw new Error(errors.join('\n'));
    this.transport.deliver(client, message);
  }

  private sendAuthority(message: PlatformToAuthorityMessage): void {
    if (!this.authority || (this.current?.gameProcess !== 'running' && message.type !== 'start')) return;
    const entry = catalog.messages.find((item) => item.from === 'platform' && item.to === 'authority' && item.type === message.type);
    if (!entry) throw new Error(`unknown IPC message ${message.type}`);
    const errors = validateJson(message, { $ref: `#/$defs/${entry.schema}` }, messageSchema);
    if (errors.length) throw new Error(errors.join('\n'));
    this.authority.receive(message);
  }

  private error(client: MockClient, code: string, text: string): void {
    this.send(client, { type: 'error', code, text });
  }
}
