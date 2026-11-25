import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { decodeIpcFrames, encodeIpcFrame } from '@bp/authority-runtime';
import type { AuthorityLaunch, AuthoritySupervisor } from '@bp/session-app';

interface Entry {
  server: net.Server;
  socket: net.Socket | null;
  child: ChildProcess;
  buffer: Buffer;
  epoch: number;
}

export interface NodeSupervisorOptions {
  onMessage(sessionId: string, message: Record<string, unknown>): void;
  /** Authority 在未被 stop 的情况下退出；调用方负责把会话标记为 failed。 */
  onExit?(sessionId: string, epoch: number, code: number | null, signal: NodeJS.Signals | null): void;
  /** 进程已 spawn，用于诊断与测试注入。 */
  onSpawn?(sessionId: string, epoch: number, pid: number): void;
  startTimeoutMs?: number;
}

/** 开发/测试用 Supervisor：spawn Authority 进程，用回环 TCP 承载 IPC。 */
export class NodeAuthoritySupervisor implements AuthoritySupervisor {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly options: NodeSupervisorOptions) {}

  async start(launch: AuthorityLaunch): Promise<void> {
    if (this.entries.has(launch.sessionId)) throw new Error('Authority 已在运行');
    const server = net.createServer();
    await new Promise<void>((resolvePromise, rejectPromise) => {
      server.once('error', rejectPromise);
      server.listen(0, '127.0.0.1', () => resolvePromise());
    });
    const address = server.address();
    const ipcPort = typeof address === 'object' && address ? address.port : 0;
    const boot = {
      sessionId: launch.sessionId,
      epoch: launch.epoch,
      roundId: launch.roundId,
      ipcPort,
      stateDir: launch.stateDir,
      members: launch.members,
      bootNonce: randomBytes(8).toString('hex'),
    };
    const python = launch.runtime === 'python' || launch.runtime === 'python3';
    const command = python
      ? (process.env.BP_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'))
      : process.execPath;
    const child = spawn(command, [launch.entry], {
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, ...launch.env },
      windowsHide: true,
    });
    if (child.pid !== undefined) this.options.onSpawn?.(launch.sessionId, launch.epoch, child.pid);
    const entry: Entry = { server, socket: null, child, buffer: Buffer.alloc(0), epoch: launch.epoch };
    this.entries.set(launch.sessionId, entry);
    child.once('exit', (code, signal) => {
      // stop() 会先从表里删除；只有“意外退出”才通知上层。
      if (this.entries.get(launch.sessionId) !== entry) return;
      this.entries.delete(launch.sessionId);
      entry.socket?.destroy();
      server.close();
      this.options.onExit?.(launch.sessionId, launch.epoch, code, signal);
    });
    server.on('connection', (socket) => {
      entry.socket = socket;
      socket.on('data', (chunk: Buffer) => {
        entry.buffer = Buffer.concat([entry.buffer, chunk]);
        const { messages, rest } = decodeIpcFrames(entry.buffer);
        entry.buffer = rest;
        for (const message of messages) this.options.onMessage(launch.sessionId, message as Record<string, unknown>);
      });
      socket.on('error', () => {});
    });

    const connected = new Promise<void>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error('Authority IPC 连接超时')), this.options.startTimeoutMs ?? 5000);
      server.once('connection', () => {
        clearTimeout(timer);
        resolvePromise();
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        rejectPromise(new Error(`Authority 在连接前退出（code=${code ?? 'null'}）`));
      });
    });
    child.stdin?.write(JSON.stringify(boot) + '\n');

    try {
      await connected;
    } catch (error) {
      await this.stop(launch.sessionId, 'start failed');
      throw error;
    }
  }

  send(sessionId: string, message: Record<string, unknown>): void {
    this.entries.get(sessionId)?.socket?.write(encodeIpcFrame(message));
  }

  async stop(sessionId: string, _reason: string): Promise<void> {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    this.entries.delete(sessionId);
    entry.socket?.destroy();
    entry.child.kill();
    await new Promise<void>((resolvePromise) => entry.server.close(() => resolvePromise()));
  }

  async stopAll(): Promise<void> {
    for (const sessionId of [...this.entries.keys()]) await this.stop(sessionId, 'shutdown');
  }
}
