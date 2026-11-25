import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { SessionApplication } from '@bp/session-app';
import type { SessionRecord } from '@bp/session-core';
import { decodeFrame, encodeFrame, FrameError, type FrameHeader } from './framing.js';

export interface SessionServerOptions {
  app: SessionApplication;
  port?: number;
  host?: string;
  httpServer?: HttpServer;
  authority?: {
    resolveEntry(session: SessionRecord): { entry: string; runtime?: string } | null;
    stateRoot: string;
  };
  onGameFrame?: (sessionId: string, memberId: string, payload: unknown) => void;
}

interface ControlBinding {
  sessionId: string;
  memberId: string;
}

interface ChannelBinding {
  sessionId: string;
  memberId: string;
  channelId: string;
}

const AUTH_TIMEOUT_MS = 5000;

const sendJson = (socket: WebSocket, value: unknown): void => {
  if (socket.readyState === 1) socket.send(JSON.stringify(value));
};

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
  private readonly dataSockets = new Map<string, Set<WebSocket>>();
  private readonly dataBinding = new Map<WebSocket, ChannelBinding>();
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

  async start(): Promise<{ port: number }> {
    this.controlWss = new WebSocketServer({ noServer: true });
    this.dataWss = new WebSocketServer({ noServer: true });
    this.http.on('upgrade', (request, socket, head) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      const target = path === '/ws/control' ? this.controlWss : path === '/ws/data' ? this.dataWss : null;
      if (!target) {
        socket.destroy();
        return;
      }
      target.handleUpgrade(request, socket, head, (ws) => {
        if (target === this.controlWss) this.onControl(ws);
        else this.onData(ws);
      });
    });
    await new Promise<void>((resolvePromise, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.port, this.host, () => resolvePromise());
    });
    const address = this.http.address();
    this.port = typeof address === 'object' && address ? address.port : this.port;
    return { port: this.port };
  }

  async close(): Promise<void> {
    for (const ws of this.controlBindings.keys()) ws.terminate();
    for (const ws of this.dataBinding.keys()) ws.terminate();
    this.controlWss?.close();
    this.dataWss?.close();
    this.http.closeAllConnections?.();
    await new Promise<void>((resolvePromise) => this.http.close(() => resolvePromise()));
  }

  private onControl(ws: WebSocket): void {
    let bound: ControlBinding | null = null;
    const timer = setTimeout(() => {
      if (!bound) ws.close(1008, 'auth timeout');
    }, AUTH_TIMEOUT_MS);
    ws.on('message', (raw) => {
      void this.handleControl(ws, raw.toString(), (binding) => {
        bound = binding;
        clearTimeout(timer);
        this.bindControl(ws, binding);
      });
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

  private async handleControl(ws: WebSocket, raw: string, bind: (binding: ControlBinding) => void): Promise<void> {
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
        bind({ sessionId: result.value.session.sessionId, memberId: result.value.memberId });
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
        bind({ sessionId: result.value.session.sessionId, memberId: result.value.memberId });
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
        bind({ sessionId: result.value.session.sessionId, memberId: result.value.memberId });
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
        if (message.type === 'sessionClose') for (const socket of this.sessionSockets.get(binding.sessionId) ?? []) socket.close(1000, 'closed');
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
      case 'channelOpen': {
        const binding = this.controlBindings.get(ws);
        if (!binding) return this.fail(ws, { code: 'NOSEAT', message: '连接未绑定成员' });
        const channelId = `ch-${randomBytes(6).toString('hex')}`;
        const channelToken = randomBytes(24).toString('hex');
        this.channels.set(channelToken, { sessionId: binding.sessionId, memberId: binding.memberId, channelId });
        sendJson(ws, { type: 'channelGranted', channelId, channelToken });
        return;
      }
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
          if (message.kind !== 'data' || typeof message.channelToken !== 'string') return ws.close(1008, 'auth required');
          const binding = this.channels.get(message.channelToken);
          if (!binding) return ws.close(1008, 'invalid token');
          authed = true;
          clearTimeout(timer);
          this.dataBinding.set(ws, binding);
          const set = this.dataSockets.get(binding.memberId) ?? new Set<WebSocket>();
          set.add(ws);
          this.dataSockets.set(binding.memberId, set);
          sendJson(ws, { type: 'dataReady', channelId: binding.channelId });
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
