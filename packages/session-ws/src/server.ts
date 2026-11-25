import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { SessionApplication } from '@bp/session-app';
import type { SessionRecord } from '@bp/session-core';
import { decodeFrame, encodeFrame, FrameError, type FrameHeader } from './framing.js';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/** 游戏 origin 的 CSP：只允许自身脚本/样式/资源，连接只回自身 WS。 */
export const GAME_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

export interface GameOriginOptions {
  host?: string;
  /** 0 表示随机端口；服务层默认给 3001。 */
  port?: number;
  /** 返回该会话的静态根与 `/` 对应的入口文件名；null 表示没有可托管的 Web 游戏。 */
  resolveRoot(session: SessionRecord): { root: string; entry: string } | null;
  /** 配置公网隧道时返回游戏 origin 的公网基地址；返回 null 时退回本机 Host + 端口。 */
  publicUrl?: () => string | null;
}

export interface SessionServerOptions {
  app: SessionApplication;
  port?: number;
  host?: string;
  httpServer?: HttpServer;
  authority?: {
    resolveEntry(session: SessionRecord): { entry: string; runtime?: string } | null;
    stateRoot: string;
  };
  gameOrigin?: GameOriginOptions;
  /** 已注册游戏清单；`listGames` 只返回这个快照，不暴露包路径。 */
  gameRegistry?: {
    entries(): Array<{ id: string; name: string; version: string; manifest: unknown }>;
  };
  /** 数据通道鉴权完成；用于向 Authority 请求该成员的 sync。 */
  onDataReady?: (sessionId: string, memberId: string) => void;
  onGameFrame?: (sessionId: string, memberId: string, payload: unknown) => void;
}

interface ControlBinding {
  sessionId: string;
  memberId: string;
  /** 建连接时的 Host 头，用来拼游戏 origin 地址。 */
  host?: string;
}

interface ChannelBinding {
  sessionId: string;
  memberId: string;
  channelId: string;
}

interface PendingHandoff {
  binding: ChannelBinding;
  expiresAt: number;
}

const AUTH_TIMEOUT_MS = 5000;
/** 浏览器交接码：30 秒、一次性，只出现在 URL fragment 里，不进服务端日志。 */
const HANDOFF_TTL_MS = 30_000;

const sendJson = (socket: WebSocket, value: unknown): void => {
  if (socket.readyState === 1) socket.send(JSON.stringify(value));
};

function safeJoin(root: string, pathname: string): string | null {
  const rootAbs = resolve(root);
  const target = resolve(join(rootAbs, pathname.replace(/^\/+/, '')));
  if (target !== rootAbs && !target.startsWith(`${rootAbs}/`) && !target.startsWith(`${rootAbs}\\`)) return null;
  return target;
}

/** 浏览器来源校验：带 Origin 就必须与 Host 一致；跨站 Sec-Fetch-Site 直接拒绝。 */
function isSameOriginRequest(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (typeof origin === 'string') {
    try {
      if (new URL(origin).host !== request.headers.host) return false;
    } catch {
      return false;
    }
  }
  const site = request.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false;
  return true;
}

function rejectUpgrade(socket: Duplex): void {
  socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  socket.destroy();
}

function listen(server: HttpServer, port: number, host: string): Promise<number> {
  return new Promise<number>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, host, () => {
      server.off('error', rejectPromise);
      const address = server.address();
      resolvePromise(typeof address === 'object' && address ? address.port : port);
    });
  });
}

function closeServer(server: HttpServer): Promise<void> {
  server.closeAllConnections?.();
  return new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
}

export class SessionServer {
  private readonly app: SessionApplication;
  private readonly options: SessionServerOptions;
  private readonly host: string;
  private http: HttpServer;
  private controlWss: WebSocketServer | null = null;
  private dataWss: WebSocketServer | null = null;
  private readonly controlBindings = new Map<WebSocket, ControlBinding>();
  private readonly sessionSockets = new Map<string, Set<WebSocket>>();
  private readonly channels = new Map<string, ChannelBinding>();
  private readonly handoffs = new Map<string, PendingHandoff>();
  private readonly dataSockets = new Map<string, Set<WebSocket>>();
  private readonly dataBinding = new Map<WebSocket, ChannelBinding>();
  private gameHttp: HttpServer | null = null;
  private gamePort = 0;
  private port: number;

  constructor(options: SessionServerOptions) {
    this.options = options;
    this.app = options.app;
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 0;
    this.http = options.httpServer ?? createHttpServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  }

  async start(): Promise<{ port: number; gamePort: number | null }> {
    this.controlWss = new WebSocketServer({ noServer: true });
    this.dataWss = new WebSocketServer({ noServer: true });
    this.http.on('upgrade', (request, socket, head) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      const target = path === '/ws/control' ? this.controlWss : path === '/ws/data' ? this.dataWss : null;
      if (!target) {
        socket.destroy();
        return;
      }
      if (!isSameOriginRequest(request)) {
        rejectUpgrade(socket);
        return;
      }
      target.handleUpgrade(request, socket, head, (ws) => {
        if (target === this.controlWss) {
          const host = request.headers.host;
          this.onControl(ws, typeof host === 'string' ? host : undefined);
        } else {
          this.onData(ws);
        }
      });
    });
    this.port = await listen(this.http, this.port, this.host);
    await this.startGameOrigin();
    return { port: this.port, gamePort: this.gameHttp ? this.gamePort : null };
  }

  private async startGameOrigin(): Promise<void> {
    const options = this.options.gameOrigin;
    if (!options) return;
    this.gameHttp = createHttpServer((request, response) => {
      void this.serveGame(request, response);
    });
    this.gameHttp.on('upgrade', (request, socket, head) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path !== '/ws/data' || !isSameOriginRequest(request)) {
        rejectUpgrade(socket);
        return;
      }
      this.dataWss!.handleUpgrade(request, socket, head, (ws) => this.onData(ws));
    });
    this.gamePort = await listen(this.gameHttp, options.port ?? 0, options.host ?? this.host);
  }

  /** 游戏 origin 静态页：路径带 sessionId，只服务该会话已注册游戏包的 Web 根。 */
  private async serveGame(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' });
      response.end();
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const match = /^\/s\/([^/]+)(\/.*)?$/.exec(pathname);
    const sessionId = match?.[1];
    if (!sessionId) {
      response.writeHead(404);
      response.end();
      return;
    }
    const session = await this.app.getSession(sessionId);
    const target = session && this.options.gameOrigin ? this.options.gameOrigin.resolveRoot(session) : null;
    if (!target) {
      response.writeHead(404);
      response.end();
      return;
    }
    const relative = match?.[2] ?? '/';
    const file = safeJoin(target.root, relative === '/' ? `/${target.entry}` : relative);
    if (!file) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
      const body = readFileSync(file);
      response.writeHead(200, {
        'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-security-policy': GAME_CSP,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-resource-policy': 'same-origin',
        'cache-control': 'no-store',
      });
      if (request.method === 'HEAD') response.end();
      else response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  }

  async close(): Promise<void> {
    for (const ws of this.controlBindings.keys()) ws.terminate();
    for (const ws of this.dataBinding.keys()) ws.terminate();
    this.controlWss?.close();
    this.dataWss?.close();
    if (this.gameHttp) await closeServer(this.gameHttp);
    await closeServer(this.http);
  }

  private onControl(ws: WebSocket, host?: string): void {
    let bound: ControlBinding | null = null;
    const timer = setTimeout(() => {
      if (!bound) ws.close(1008, 'auth timeout');
    }, AUTH_TIMEOUT_MS);
    ws.on('message', (raw) => {
      void this.handleControl(ws, raw.toString(), (binding) => {
        bound = binding;
        clearTimeout(timer);
        this.bindControl(ws, binding);
      }, host);
    });
    ws.on('close', () => {
      clearTimeout(timer);
      const binding = this.controlBindings.get(ws);
      if (!binding) return;
      this.controlBindings.delete(ws);
      this.sessionSockets.get(binding.sessionId)?.delete(ws);
      void this.app.disconnectMember(binding.sessionId, binding.memberId).then((result) => {
        if (result?.ok) this.broadcastState(result.value);
      });
    });
  }

  private bindControl(ws: WebSocket, binding: ControlBinding): void {
    this.controlBindings.set(ws, binding);
    const set = this.sessionSockets.get(binding.sessionId) ?? new Set<WebSocket>();
    set.add(ws);
    this.sessionSockets.set(binding.sessionId, set);
  }

  private async handleControl(
    ws: WebSocket,
    raw: string,
    bind: (binding: ControlBinding) => void,
    host?: string,
  ): Promise<void> {
    const seat = (sessionId: string, memberId: string): ControlBinding => ({
      sessionId,
      memberId,
      ...(host === undefined ? {} : { host }),
    });
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      sendJson(ws, { type: 'error', code: 'BADMSG', text: '消息不是合法 JSON' });
      return;
    }
    switch (message.type) {
      case 'hello':
        sendJson(ws, { type: 'welcome', protocolVersion: 1, serverVersion: '0.1.0' });
        return;
      case 'sessionCreate': {
        const result = await this.app.create({
          gameId: String(message.gameId ?? ''),
          gameVersion: String(message.gameVersion ?? ''),
          ...(typeof message.title === 'string' ? { title: message.title } : {}),
          ...(typeof message.inviteSecret === 'string' ? { inviteSecret: message.inviteSecret } : {}),
        });
        if (!result.ok) return this.fail(ws, result.error);
        bind(seat(result.value.session.sessionId, result.value.memberId));
        sendJson(ws, {
          type: 'seatGranted', sessionId: result.value.session.sessionId, code: result.value.session.code,
          memberId: result.value.memberId, resumeToken: result.value.resumeToken, generation: result.value.generation,
        });
        this.broadcastState(result.value.session);
        return;
      }
      case 'sessionJoin': {
        const result = await this.app.join({
          sessionId: String(message.sessionId ?? ''),
          code: String(message.code ?? ''),
          ...(typeof message.inviteSecret === 'string' ? { inviteSecret: message.inviteSecret } : {}),
          ...(typeof message.displayName === 'string' ? { displayName: message.displayName } : {}),
        });
        if (!result.ok) return this.fail(ws, result.error);
        bind(seat(result.value.session.sessionId, result.value.memberId));
        sendJson(ws, {
          type: 'seatGranted', sessionId: result.value.session.sessionId, code: result.value.session.code,
          memberId: result.value.memberId, resumeToken: result.value.resumeToken, generation: result.value.generation,
        });
        this.broadcastState(result.value.session);
        return;
      }
      case 'sessionResume': {
        const result = await this.app.resumeMember({
          sessionId: String(message.sessionId ?? ''),
          presentedToken: String(message.resumeToken ?? ''),
        });
        if (!result.ok) return this.fail(ws, result.error);
        bind(seat(result.value.session.sessionId, result.value.memberId));
        sendJson(ws, {
          type: 'seatGranted', sessionId: result.value.session.sessionId, code: result.value.session.code,
          memberId: result.value.memberId, resumeToken: result.value.resumeToken, generation: result.value.generation,
        });
        this.broadcastState(result.value.session);
        return;
      }
      case 'sessionLeave':
      case 'memberKick':
      case 'sessionClose': {
        const binding = this.controlBindings.get(ws);
        if (!binding) return this.fail(ws, { code: 'NOSEAT', message: '连接未绑定成员' });
        const result = message.type === 'sessionLeave'
          ? await this.app.leaveSession(binding.sessionId, binding.memberId)
          : message.type === 'memberKick'
            ? await this.app.kickMember(binding.sessionId, binding.memberId, String(message.targetMemberId ?? ''))
            : await this.app.closeSession(binding.sessionId, binding.memberId);
        if (!result.ok) return this.fail(ws, result.error);
        this.broadcastState(result.value);
        if (message.type === 'sessionClose') {
          void this.app.stopAuthority(binding.sessionId, 'session closed');
          for (const socket of this.sessionSockets.get(binding.sessionId) ?? []) socket.close(1000, 'closed');
        }
        return;
      }
      case 'startGame': {
        const binding = this.controlBindings.get(ws);
        if (!binding) return this.fail(ws, { code: 'NOSEAT', message: '连接未绑定成员' });
        if (!this.options.authority) return this.fail(ws, { code: 'GAMEFAILED', message: '没有配置权威启动器' });
        const session = await this.app.getSession(binding.sessionId);
        if (!session) return this.fail(ws, { code: 'NOROOM', message: '会话不存在' });
        const target = this.options.authority.resolveEntry(session);
        if (!target) return this.fail(ws, { code: 'UNKNOWN_GAME', message: '游戏未注册' });
        const result = await this.app.startGame(binding.sessionId, binding.memberId, {
          entry: target.entry,
          ...(target.runtime === undefined ? {} : { runtime: target.runtime }),
          stateRoot: this.options.authority.stateRoot,
        });
        if (!result.ok) return this.fail(ws, result.error);
        this.broadcastState(result.value);
        return;
      }
      case 'recoverGame': {
        const binding = this.controlBindings.get(ws);
        if (!binding) return this.fail(ws, { code: 'NOSEAT', message: '连接未绑定成员' });
        if (!this.options.authority) return this.fail(ws, { code: 'GAMEFAILED', message: '没有配置权威启动器' });
        const session = await this.app.getSession(binding.sessionId);
        if (!session) return this.fail(ws, { code: 'NOROOM', message: '会话不存在' });
        const target = this.options.authority.resolveEntry(session);
        if (!target) return this.fail(ws, { code: 'UNKNOWN_GAME', message: '游戏未注册' });
        const result = await this.app.recoverGame(binding.sessionId, binding.memberId, {
          entry: target.entry,
          ...(target.runtime === undefined ? {} : { runtime: target.runtime }),
          stateRoot: this.options.authority.stateRoot,
        });
        if (!result.ok) return this.fail(ws, result.error);
        this.broadcastState(result.value);
        return;
      }
      case 'channelOpen': {
        const binding = this.controlBindings.get(ws);
        if (!binding) return this.fail(ws, { code: 'NOSEAT', message: '连接未绑定成员' });
        const channelId = `ch-${randomBytes(6).toString('hex')}`;
        const channelToken = randomBytes(24).toString('hex');
        const channelBinding: ChannelBinding = { sessionId: binding.sessionId, memberId: binding.memberId, channelId };
        this.channels.set(channelToken, channelBinding);
        const now = Date.now();
        for (const [code, entry] of this.handoffs) {
          if (entry.expiresAt <= now) this.handoffs.delete(code);
        }
        const handoffCode = randomBytes(24).toString('hex');
        this.handoffs.set(handoffCode, { binding: channelBinding, expiresAt: now + HANDOFF_TTL_MS });
        const gameUrl = this.gameUrlFor(binding, handoffCode);
        sendJson(ws, {
          type: 'channelGranted',
          channelId,
          channelToken,
          handoffCode,
          ...(gameUrl === undefined ? {} : { gameUrl }),
        });
        return;
      }
      case 'listGames':
        sendJson(ws, {
          type: 'gameList',
          games: (this.options.gameRegistry?.entries() ?? []).slice(0, 200),
        });
        return;
      case 'ping':
        sendJson(ws, { type: 'pong', nonce: message.nonce });
        return;
      default:
        sendJson(ws, { type: 'error', code: 'BADMSG', text: '未知控制消息' });
    }
  }

  private onData(ws: WebSocket): void {
    const timer = setTimeout(() => ws.close(1008, 'auth timeout'), AUTH_TIMEOUT_MS);
    let authed = false;
    ws.on('message', (raw, isBinary) => {
      if (!authed) {
        if (isBinary) return ws.close(1008, 'auth required');
        try {
          const message = JSON.parse(raw.toString()) as Record<string, unknown>;
          let binding: ChannelBinding | undefined;
          if (message.kind === 'data' && typeof message.channelToken === 'string') {
            binding = this.channels.get(message.channelToken);
          } else if (message.kind === 'data' && typeof message.handoffCode === 'string') {
            const pending = this.handoffs.get(message.handoffCode);
            this.handoffs.delete(message.handoffCode);
            if (pending && pending.expiresAt > Date.now()) binding = pending.binding;
          }
          if (!binding) return ws.close(1008, 'invalid token');
          authed = true;
          clearTimeout(timer);
          this.dataBinding.set(ws, binding);
          const set = this.dataSockets.get(binding.memberId) ?? new Set<WebSocket>();
          set.add(ws);
          this.dataSockets.set(binding.memberId, set);
          sendJson(ws, { type: 'dataReady', channelId: binding.channelId });
          this.options.onDataReady?.(binding.sessionId, binding.memberId);
        } catch {
          ws.close(1008, 'auth required');
        }
        return;
      }
      const binding = this.dataBinding.get(ws);
      if (!binding) return;
      if (!isBinary) return;
      let frame;
      try {
        frame = decodeFrame(raw as Buffer);
      } catch (error) {
        sendJson(ws, { type: 'error', code: 'BADMSG', text: error instanceof FrameError ? error.message : '坏帧' });
        return;
      }
      if (this.options.onGameFrame) {
        const text = frame.payload.toString('utf8');
        let payload: unknown = text;
        try { payload = JSON.parse(text); } catch { /* 非 JSON 保持字符串 */ }
        this.options.onGameFrame(binding.sessionId, binding.memberId, payload);
        return;
      }
      const targets = frame.header.to === 'all'
        ? [...(this.dataSockets.get(binding.memberId) ?? [])].filter((socket) => socket !== ws)
        : [...(this.dataSockets.get(frame.header.to) ?? [])];
      const outbound = encodeFrame({ ...frame.header, from: binding.memberId } as FrameHeader, frame.payload);
      for (const target of targets) if (target.readyState === 1) target.send(outbound);
    });
    ws.on('close', () => {
      clearTimeout(timer);
      const binding = this.dataBinding.get(ws);
      if (binding) this.dataSockets.get(binding.memberId)?.delete(ws);
      this.dataBinding.delete(ws);
    });
  }

  private fail(ws: WebSocket, error: { code: string; message: string }): void {
    sendJson(ws, { type: 'error', code: error.code, text: error.message });
  }

  /** 优先用游戏隧道公网地址；没有隧道时用控制连接握手时的 Host + 本地游戏端口。 */
  private gameUrlFor(binding: ControlBinding, handoffCode: string): string | undefined {
    if (!this.options.gameOrigin || !this.gameHttp) return undefined;
    const publicUrl = this.options.gameOrigin.publicUrl?.() ?? null;
    if (publicUrl) {
      return `${publicUrl.replace(/\/+$/, '')}/s/${encodeURIComponent(binding.sessionId)}/#handoff=${handoffCode}`;
    }
    if (!binding.host) return undefined;
    let hostname: string;
    try {
      hostname = new URL(`http://${binding.host}`).hostname;
    } catch {
      return undefined;
    }
    const port = this.gamePort === 80 ? '' : `:${this.gamePort}`;
    return `http://${hostname}${port}/s/${encodeURIComponent(binding.sessionId)}/#handoff=${handoffCode}`;
  }

  private broadcastState(session: SessionRecord): void {
    const payload = { type: 'sessionState', session };
    for (const socket of this.sessionSockets.get(session.sessionId) ?? []) sendJson(socket, payload);
  }

  broadcastSessionState(session: SessionRecord): void {
    this.broadcastState(session);
  }

  /** 把权威结果发给某个成员的数据连接；每个连接用自己的 channelId 组帧。 */
  sendToMemberGame(sessionId: string, memberId: string, payload: unknown, meta: { viewSeq?: number } = {}): void {
    const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
    for (const socket of this.dataSockets.get(memberId) ?? []) {
      const binding = this.dataBinding.get(socket);
      if (!binding || binding.sessionId !== sessionId || socket.readyState !== 1) continue;
      const frame = encodeFrame({
        v: 1,
        channelId: binding.channelId,
        to: memberId,
        seq: Math.max(1, meta.viewSeq ?? 1),
        mode: 'reliable',
        payloadBytes: bytes.byteLength,
      }, bytes);
      socket.send(frame);
    }
  }
}
