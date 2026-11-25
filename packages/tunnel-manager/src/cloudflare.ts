import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeSpawner, tunnelEnvironment } from './spawn.js';
import type {
  TunnelConfig,
  TunnelErrorCode,
  TunnelMode,
  TunnelPhase,
  TunnelProcess,
  TunnelSpawner,
  TunnelStatus,
} from './types.js';

const QUICK_URL = /https:\/\/(?!api\.)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com/i;
const NAMED_READY = /\bRegistered tunnel connection\b|\bConnection\b.*\bregistered\b/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_+/=-]{20,8192}$/;

export interface CloudflareTunnelOptions extends TunnelConfig {
  name: string;
  binaryPath: string;
  spawner?: TunnelSpawner;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  namedReadyDelayMs?: number;
  env?: NodeJS.ProcessEnv;
}

export class TunnelError extends Error {
  constructor(readonly code: TunnelErrorCode, message: string) {
    super(message);
    this.name = 'TunnelError';
  }
}

export class CloudflareTunnel {
  private readonly options: CloudflareTunnelOptions;
  private readonly spawner: TunnelSpawner;
  private status: TunnelStatus;
  private process: TunnelProcess | null = null;
  private tempDir: string | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  private readyTimer: NodeJS.Timeout | null = null;
  private startResolve: ((status: TunnelStatus) => void) | null = null;
  private startReject: ((error: Error) => void) | null = null;
  private readonly listeners = new Set<(status: TunnelStatus) => void>();

  constructor(options: CloudflareTunnelOptions) {
    this.options = options;
    this.spawner = options.spawner ?? nodeSpawner;
    this.status = {
      name: options.name,
      mode: options.mode,
      phase: 'stopped',
      localPort: options.localPort,
      publicUrl: null,
      updatedAt: Date.now(),
    };
    this.validate();
  }

  private validate(): void {
    const { localPort, mode, token, hostname } = this.options;
    if (mode !== 'quick' && mode !== 'named') throw new TunnelError('configuration', 'mode 必须是 quick 或 named');
    if (!Number.isInteger(localPort) || localPort < 1024 || localPort > 65535) {
      throw new TunnelError('configuration', 'localPort 必须在 1024–65535');
    }
    if (mode === 'named' && (!token || !TOKEN_PATTERN.test(token))) {
      throw new TunnelError('token', 'named 模式需要合法 Cloudflare Tunnel Token');
    }
    if (mode === 'named' && (!hostname || !/^[a-z0-9.-]+$/i.test(hostname))) {
      throw new TunnelError('configuration', 'named 模式需要合法 hostname');
    }
  }

  getStatus(): TunnelStatus {
    return { ...this.status };
  }

  onChange(listener: (status: TunnelStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(patch: Partial<TunnelStatus>): void {
    this.status = { ...this.status, ...patch, updatedAt: Date.now() };
    for (const listener of this.listeners) listener(this.getStatus());
  }

  private fail(code: TunnelErrorCode, text: string): void {
    this.clearTimers();
    this.setStatus({ phase: 'failed', publicUrl: null, errorCode: code, errorText: text });
    if (this.startReject) {
      const reject = this.startReject;
      this.startReject = null;
      this.startResolve = null;
      reject(new TunnelError(code, text));
    }
  }

  private clearTimers(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.startTimer = null;
    this.readyTimer = null;
  }

  start(): Promise<TunnelStatus> {
    if (this.status.phase === 'ready' || this.status.phase === 'starting' || this.status.phase === 'registering') {
      return Promise.resolve(this.getStatus());
    }
    return new Promise<TunnelStatus>((resolvePromise, rejectPromise) => {
      this.startResolve = resolvePromise;
      this.startReject = rejectPromise;
      void this.launch();
    });
  }

  private async launch(): Promise<void> {
    const startedAt = Date.now();
    this.setStatus({ phase: 'starting', publicUrl: null, errorCode: undefined, errorText: undefined, startedAt });
    try {
      this.tempDir = await mkdtemp(join(tmpdir(), 'bp-tunnel-'));
      const env = tunnelEnvironment(this.options.env ?? process.env, this.tempDir, this.options.token);
      this.process = this.spawner.start(this.options, this.options.binaryPath, env);
    } catch (error) {
      this.fail('runtime', error instanceof Error ? error.message : String(error));
      return;
    }
    this.setStatus({ pid: this.process.pid });
    this.startTimer = setTimeout(() => {
      this.fail('timeout', `隧道在 ${this.options.startTimeoutMs ?? 30_000}ms 内未就绪`);
    }, this.options.startTimeoutMs ?? 30_000);

    const onLine = (line: string): void => {
      const match = QUICK_URL.exec(line);
      if (this.options.mode === 'quick' && match) this.markReady(match[0]);
      if (this.options.mode === 'named' && NAMED_READY.test(line) && this.options.hostname) {
        this.markReady(`https://${this.options.hostname}`);
      }
    };
    this.pipeLines(this.process.stdout, onLine);
    this.pipeLines(this.process.stderr, onLine);

    this.process.onExit((code, signal) => {
      if (this.status.phase === 'ready' || this.status.phase === 'starting' || this.status.phase === 'registering') {
        this.fail('runtime', `cloudflared 退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`);
      } else if (this.status.phase !== 'stopped') {
        this.setStatus({ phase: 'failed', publicUrl: null, errorCode: 'runtime', errorText: `cloudflared 退出（${code ?? signal}）` });
      }
    });

    if (this.options.mode === 'named' && this.options.hostname) {
      this.setStatus({ phase: 'registering' });
      this.readyTimer = setTimeout(() => {
        this.markReady(`https://${this.options.hostname}`);
      }, this.options.namedReadyDelayMs ?? 1200);
    }
  }

  private pipeLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
    let buffer = '';
    stream.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) onLine(line);
      if (buffer.length > 256 * 1024) buffer = buffer.slice(-4096);
    });
  }

  private markReady(url: string): void {
    if (this.status.phase === 'ready') return;
    this.clearTimers();
    this.setStatus({ phase: 'ready', publicUrl: url, errorCode: undefined, errorText: undefined });
    if (this.startResolve) {
      const resolvePromise = this.startResolve;
      this.startResolve = null;
      this.startReject = null;
      resolvePromise(this.getStatus());
    }
  }

  async stop(): Promise<void> {
    this.clearTimers();
    const process = this.process;
    this.process = null;
    if (process) {
      const timeout = this.options.stopTimeoutMs ?? 2000;
      const exited = new Promise<void>((resolvePromise) => process.onExit(() => resolvePromise()));
      process.kill('SIGTERM');
      await Promise.race([
        exited,
        new Promise<void>((resolvePromise) => setTimeout(resolvePromise, timeout)),
      ]);
      process.kill('SIGKILL');
    }
    if (this.tempDir) {
      await rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
      this.tempDir = null;
    }
    this.setStatus({ phase: 'stopped', publicUrl: null, pid: undefined });
  }
}
