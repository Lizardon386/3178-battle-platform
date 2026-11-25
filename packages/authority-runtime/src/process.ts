import { once } from 'node:events';
import net from 'node:net';
import { decodeIpcFrames, encodeIpcFrame } from './frames.js';
import type { Transport } from './types.js';

export interface BootFrame {
  sessionId: string;
  epoch: number;
  roundId: string;
  ipcPort: number;
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

/** 连接 Supervisor 的 IPC 端口，启动运行时并持续处理帧。 */
export async function runAuthorityProcess(options: {
  boot: BootFrame;
  createRuntime: (transport: Transport) => AuthorityProcessRuntime;
}): Promise<void> {
  const socket = net.connect(options.boot.ipcPort, '127.0.0.1');
  await once(socket, 'connect');
  const transport: Transport = { send: (message) => socket.write(encodeIpcFrame(message)) };
  const runtime = options.createRuntime(transport);
  await runtime.start();

  let buffer: Buffer = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]) as Buffer;
    const { messages, rest } = decodeIpcFrames(buffer);
    buffer = rest as Buffer;
    for (const message of messages) void runtime.handle(message as Record<string, unknown>);
  });
  await new Promise<void>((resolvePromise) => socket.once('close', () => resolvePromise()));
}
