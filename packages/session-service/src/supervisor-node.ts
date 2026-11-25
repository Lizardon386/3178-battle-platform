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
}

export interface NodeSupervisorOptions {
  onMessage(sessionId: string, message: Record<string, unknown>): void;
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
    const child = spawn(process.execPath, [launch.entry], {
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, ...launch.env },
      windowsHide: true,
    });
    const entry: Entry = { server, socket: null, child, buffer: Buffer.alloc(0) };
    this.entries.set(launch.sessionId, entry);
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
