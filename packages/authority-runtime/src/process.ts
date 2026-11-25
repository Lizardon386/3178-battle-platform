import { once } from 'node:events';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { decodeIpcFrames, encodeIpcFrame } from './frames.js';
import { AuthorityRuntime } from './runtime.js';
import type { RuntimeOptions, Transport } from './types.js';

export interface BootFrame {
  sessionId: string;
  epoch: number;
  roundId: string;
  /** Windows 命名管道路径或 POSIX Unix socket 路径。 */
  ipcPath?: string;
  /** 仅用于兼容旧 Supervisor；新代码优先 ipcPath。 */
  ipcPort?: number;
  stateDir: string;
  members: Array<{ memberId: string; displayName?: string }>;
  bootNonce?: string;
}

/** 从 Supervisor 的 stdin 读第一行 BootFrame；不进命令行、不进环境。 */
export async function readBootFrame(stream: NodeJS.ReadableStream = process.stdin): Promise<BootFrame> {
  return new Promise<BootFrame>((resolvePromise, rejectPromise) => {
    let buffer = '';
    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString();
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      stream.off('data', onData);
      try {
        resolvePromise(JSON.parse(buffer.slice(0, newline)) as BootFrame);
      } catch (error) {
        rejectPromise(error instanceof Error ? error : new Error(String(error)));
      }
    };
    stream.on('data', onData);
    stream.once('error', rejectPromise);
  });
}

export interface AuthorityProcessRuntime {
  start(): Promise<void>;
  handle(message: Record<string, unknown>): Promise<void>;
}

export interface AuthorityModuleContext {
  boot: BootFrame;
  transport: Transport;
  /** 平台提供的运行库；游戏模块不直接 import @bp/authority-runtime。 */
  createRuntime(options: RuntimeOptions): AuthorityProcessRuntime;
}

export type AuthorityModuleFactory = (
  context: AuthorityModuleContext,
) => AuthorityProcessRuntime | Promise<AuthorityProcessRuntime>;

const connect = (boot: BootFrame): net.Socket => {
  if (boot.ipcPath) return net.connect(boot.ipcPath);
  if (boot.ipcPort !== undefined) return net.connect(boot.ipcPort, '127.0.0.1');
  throw new Error('BootFrame 缺少 ipcPath');
};

async function serve(socket: net.Socket, runtime: AuthorityProcessRuntime): Promise<void> {
  let buffer: Buffer = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]) as Buffer;
    const { messages, rest } = decodeIpcFrames(buffer);
    buffer = rest as Buffer;
    for (const message of messages) void runtime.handle(message as Record<string, unknown>);
  });
  await new Promise<void>((resolvePromise) => socket.once('close', () => resolvePromise()));
}

/** 连接 Supervisor 的 IPC（命名管道/Unix socket 优先），启动运行时并持续处理帧。 */
export async function runAuthorityProcess(options: {
  boot: BootFrame;
  createRuntime: (transport: Transport) => AuthorityProcessRuntime;
}): Promise<void> {
  const socket = connect(options.boot);
  await once(socket, 'connect');
  const transport: Transport = { send: (message) => socket.write(encodeIpcFrame(message)) };
  const runtime = options.createRuntime(transport);
  await runtime.start();
  await serve(socket, runtime);
}

/**
 * 模块模型：入口导出 createAuthority({ boot, transport, createRuntime })。
 * 仍在独立子进程运行，由平台 runner 加载，不把运行库打进游戏包。
 */
export async function runAuthorityModule(modulePath: string): Promise<void> {
  const boot = await readBootFrame();
  // 先在连接前校验模块导出并构造 runtime：失败时 Supervisor 会看到“连接前退出”，
  // 而不是先连上再崩，避免平台误判为已 running。
  let socket: net.Socket | null = null;
  const queued: Buffer[] = [];
  const transport: Transport = {
    send: (message) => {
      const frame = encodeIpcFrame(message);
      if (socket) socket.write(frame);
      else queued.push(frame);
    },
  };
  const imported = await import(pathToFileURL(modulePath).href) as Record<string, unknown>;
  const factory = imported.createAuthority ?? imported.default;
  if (typeof factory !== 'function') {
    throw new Error('游戏模块必须导出 createAuthority 或 default 函数');
  }
  const runtime = await (factory as AuthorityModuleFactory)({
    boot,
    transport,
    createRuntime: (options: RuntimeOptions) => new AuthorityRuntime(options),
  });

  socket = connect(boot);
  await once(socket, 'connect');
  for (const frame of queued) socket.write(frame);
  queued.length = 0;
  await runtime.start();
  await serve(socket, runtime);
}
