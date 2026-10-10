import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseClientMessage } from '@bp/protocol';
import type { Engine } from './engine.js';
import type { TransportHandle } from './room.js';

export interface TransportOptions {
  path?: string;
  /**
   * 默认放行跨源连接——本机壳连远程房主靠的就是这一点（旧项目也不校验 Origin）。
   * 给了列表就按白名单拦；没有 Origin 头（原生客户端、脚本）一律放行。
   */
  allowOrigins?: string[];
  maxPayload?: number;
  heartbeatMs?: number;
}

const OPEN = 1;

function asText(data: Buffer | string | ArrayBuffer): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return Buffer.from(data).toString('utf8');
}

/** ws 与引擎之间的那层薄壳：只做握手、编码、心跳，不判断任何业务。 */
export class WsTransport {
  private wss: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly alive = new WeakMap<WebSocket, boolean>();

  constructor(
    private readonly engine: Engine,
    private readonly opts: TransportOptions = {},
  ) {}

  attach(server: HttpServer): void {
    const wss = new WebSocketServer({
      server,
      path: this.opts.path ?? '/ws',
      maxPayload: this.opts.maxPayload ?? 64 * 1024,
    });
    this.wss = wss;
    wss.on('connection', (ws, req) => this.onConnection(ws, req));
    const ms = this.opts.heartbeatMs ?? 30_000;
    this.heartbeat = setInterval(() => this.pingAll(), ms);
    this.heartbeat.unref?.();
  }

  private originAllowed(origin: string | undefined): boolean {
    if (!this.opts.allowOrigins || this.opts.allowOrigins.length === 0) return true;
    if (!origin) return true;
    return this.opts.allowOrigins.includes(origin);
  }

  private onConnection(ws: WebSocket, req: { headers: Record<string, string | string[] | undefined> }): void {
    const origin = req.headers.origin;
    if (!this.originAllowed(typeof origin === 'string' ? origin : undefined)) {
      ws.close(1008, 'origin not allowed');
      return;
    }
    this.alive.set(ws, true);
    ws.on('pong', () => this.alive.set(ws, true));
    ws.on('error', () => ws.terminate());

    const transport: TransportHandle = {
      send: (raw: string) => {
        if (ws.readyState === OPEN) ws.send(raw);
      },
      close: (code?: number, reason?: string) => {
        try {
          ws.close(code ?? 1000, reason);
        } catch {
          ws.terminate();
        }
      },
    };
    const connId = this.engine.openConn(transport);

    ws.on('message', (data: Buffer | string) => {
      const parsed = parseClientMessage(asText(data));
      if (!parsed.ok) {
        transport.send(JSON.stringify({ type: 'error', code: 'BADMSG', message: parsed.reason }));
        return;
      }
      this.engine.publish(this.engine.dispatch(connId, parsed.message));
    });

    ws.on('close', () => {
      this.engine.publish(this.engine.closeConn(connId));
    });
  }

  private pingAll(): void {
    if (!this.wss) return;
    for (const ws of this.wss.clients) {
      if (this.alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      this.alive.set(ws, false);
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }

  /** 供 hostd 挂 tick 与优雅关闭。 */
  tick(): void {
    this.engine.publish(this.engine.tick());
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    const wss = this.wss;
    this.wss = null;
    if (!wss) return;
    // 主动断开：等客户端自己关会让关服流程挂在半路。
    for (const ws of wss.clients) ws.terminate();
    await Promise.race([
      new Promise<void>((resolve) => wss.close(() => resolve())),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]);
  }
}
