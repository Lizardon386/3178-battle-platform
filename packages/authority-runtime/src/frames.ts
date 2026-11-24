export const MAX_IPC_FRAME_BYTES = 1024 * 1024;

export class IpcFrameError extends Error {}

export function encodeIpcFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.byteLength > MAX_IPC_FRAME_BYTES) throw new IpcFrameError('IPC 帧超过 1 MiB');
  const frame = Buffer.allocUnsafe(4 + body.byteLength);
  frame.writeUInt32BE(body.byteLength, 0);
  body.copy(frame, 4);
  return frame;
}

/** 从缓冲区里尽可能多地切出完整帧；返回剩余字节，处理半包/粘包。 */
export function decodeIpcFrames(buffer: Buffer): { messages: unknown[]; rest: Buffer } {
  const messages: unknown[] = [];
  let offset = 0;
  while (buffer.byteLength - offset >= 4) {
    const length = buffer.readUInt32BE(offset);
    if (length <= 0 || length > MAX_IPC_FRAME_BYTES) throw new IpcFrameError('IPC 帧长度非法');
    if (buffer.byteLength - offset - 4 < length) break;
    const body = buffer.subarray(offset + 4, offset + 4 + length);
    try {
      messages.push(JSON.parse(body.toString('utf8')));
    } catch {
      throw new IpcFrameError('IPC 帧不是合法 JSON');
    }
    offset += 4 + length;
  }
  return { messages, rest: buffer.subarray(offset) };
}
