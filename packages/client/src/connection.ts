import { parseServerMessage, type ClientMessage, type ServerMessage } from '@bp/protocol';

/**
 * 连接层：地址可配、指数退避重连、心跳校时。
 * 旧客户端把房主地址写死成 `location.host`、断线后固定 1.5 秒盲重连，这里两样都换掉。
 * Socket 与定时器都走注入，所以这套逻辑能在 node 里测，不必真开浏览器。
 */

export interface SocketLike {
  send(raw: string): void;
  close(code?: number, reason?: string): void;
}

export interface SocketBinding {
  socket: SocketLike;
  bind(handlers: {
    open: () => void;
    message: (raw: string) => void;
    close: (code: number) => void;
    error: (cause: unknown) => void;
  }): void;
}

export type SocketFactory = (url: string) => SocketBinding;

export interface Timers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'retrying' | 'closed';

export interface ConnectionState {
  status: ConnectionStatus;
  attempts: number;
  lastError: string | null;
  wsUrl: string | null;
}

export interface ConnectionHandlers {
  /** 每次 open 后第一条；把"本机装了哪些游戏版本"带上去。 */
  hello(): Extract<ClientMessage, { type: 'hello' }>;
  onMessage(message: ServerMessage): void;
  onState?(state: ConnectionState): void;
  onProtocolError?(reason: string): void;
}

export interface ConnectionOptions {
  factory: SocketFactory;
  timers?: Timers;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  pingEveryMs?: number;
  now?: () => number;
  random?: () => number;
}

const wallTimers: Timers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms) as unknown,
  clearTimeout: (handle) => {
    clearTimeout(handle as number);
  },
};

/** 浏览器实现：真 WebSocket。 */
export function browserSocketFactory(): SocketFactory {
  return (url: string) => {
    const ws = new WebSocket(url);
    return {
      socket: {
        send: (raw: string) => ws.send(raw),
        close: (code?: number, reason?: string) => ws.close(code ?? 1000, reason),
      },
      bind(handlers) {
        ws.onopen = () => handlers.open();
        ws.onmessage = (event: MessageEvent) => handlers.message(String(event.data));
        ws.onclose = (event: CloseEvent) => handlers.close(event.code);
        ws.onerror = (event: Event) => handlers.error(event);
      },
    };
  };
}

export class PlatformConnection {
  private readonly factory: SocketFactory;
  private readonly timers: Timers;
  private readonly base: number;
  private readonly max: number;
  private readonly pingEveryMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private socket: SocketLike | null = null;
  private state: ConnectionState = { status: 'idle', attempts: 0, lastError: null, wsUrl: null };
  private retryHandle: unknown = null;
  private pingHandle: unknown = null;
  private intentional = false;
  private nonceSeq = 0;

  constructor(
    private readonly handlers: ConnectionHandlers,
    opts: ConnectionOptions,
  ) {
    this.factory = opts.factory;
    this.timers = opts.timers ?? wallTimers;
    this.base = opts.backoffBaseMs ?? 500;
    this.max = opts.backoffMaxMs ?? 5_000;
    this.pingEveryMs = opts.pingEveryMs ?? 15_000;
    this.now = opts.now ?? (() => Date.now());
    this.random = opts.random ?? Math.random;
  }

  get currentState(): ConnectionState {
    return this.state;
  }

  connect(wsUrl: string): void {
    this.intentional = false;
    this.open(wsUrl);
  }

  private open(wsUrl: string): void {
    this.cancelRetry();
    this.setState({ status: this.state.attempts === 0 ? 'connecting' : 'retrying', wsUrl, lastError: null });
    const binding = this.factory(wsUrl);
    binding.bind({
      open: () => {
        this.setState({ status: 'open', attempts: 0, wsUrl, lastError: null });
        this.sendRaw(this.handlers.hello());
        this.schedulePing();
      },
      message: (raw) => {
        const parsed = parseServerMessage(raw);
        if (!parsed.ok) {
          this.handlers.onProtocolError?.(parsed.reason);
          return;
        }
        this.handlers.onMessage(parsed.message);
      },
      close: (code) => {
        this.cancelPing();
        this.socket = null;
        if (this.intentional) {
          this.setState({ status: 'closed', lastError: null, wsUrl });
          return;
        }
        const delay = this.backoffDelay();
        this.setState({
          status: 'retrying',
          lastError: `连接断开（${code}），约 ${(delay / 1000).toFixed(1)} 秒后重连`,
          wsUrl,
        });
        this.retryHandle = this.timers.setTimeout(() => this.open(wsUrl), delay);
      },
      error: () => {
        this.handlers.onProtocolError?.('socket error');
      },
    });
    this.socket = binding.socket;
  }

  /** min(base · 2^n, max) + 抖动，避免一桌人同时砸房主。 */
  private backoffDelay(): number {
    const exponent = Math.min(10, this.state.attempts);
    const raw = Math.min(this.max, this.base * 2 ** exponent);
    this.state = { ...this.state, attempts: this.state.attempts + 1 };
    return raw + Math.round(raw * 0.2 * this.random());
  }

  private schedulePing(): void {
    this.cancelPing();
    if (this.pingEveryMs <= 0) return;
    this.pingHandle = this.timers.setTimeout(() => {
      this.sendRaw({ type: 'ping', nonce: `n${(this.nonceSeq += 1)}-${this.now()}` });
      this.schedulePing();
    }, this.pingEveryMs);
  }

  private cancelPing(): void {
    if (this.pingHandle !== null) this.timers.clearTimeout(this.pingHandle);
    this.pingHandle = null;
  }

  private cancelRetry(): void {
    if (this.retryHandle !== null) this.timers.clearTimeout(this.retryHandle);
    this.retryHandle = null;
  }

  send(message: ClientMessage): boolean {
    return this.sendRaw(message);
  }

  private sendRaw(message: ClientMessage): boolean {
    if (!this.socket) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /** 玩家点"重新连接"时立刻重试，不等退避计时。 */
  retryNow(): void {
    if (!this.state.wsUrl) return;
    this.socket?.close(1000, 'manual retry');
    this.open(this.state.wsUrl);
  }

  close(code = 1000, reason = 'bye'): void {
    this.intentional = true;
    this.cancelRetry();
    this.cancelPing();
    this.socket?.close(code, reason);
    this.socket = null;
    this.setState({ status: 'closed', lastError: null });
  }

  private setState(patch: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...patch };
    this.handlers.onState?.(this.state);
  }
}
