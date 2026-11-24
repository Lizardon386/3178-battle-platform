export type FrameMode = 'reliable' | 'latest';

export interface FrameHeader {
  v: 1;
  channelId: string;
  to: string;
  seq: number;
  mode: FrameMode;
  key?: string;
  contentType?: string;
  payloadBytes: number;
  from?: string;
}

export const MAX_FRAME_BYTES = 1024 * 1024;

export class FrameError extends Error {}

export function encodeFrame(header: FrameHeader, payload: Uint8Array): Buffer {
  if (payload.byteLength !== header.payloadBytes) {
    throw new FrameError('payloadBytes 与 payload 长度不一致');
  }
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  if (headerBytes.byteLength > 16 * 1024) throw new FrameError('帧头过大');
  if (headerBytes.byteLength + payload.byteLength > MAX_FRAME_BYTES) throw new FrameError('帧超过上限');
  const out = Buffer.allocUnsafe(4 + headerBytes.byteLength + payload.byteLength);
  out.writeUInt32BE(headerBytes.byteLength, 0);
  headerBytes.copy(out, 4);
  Buffer.from(payload).copy(out, 4 + headerBytes.byteLength);
  return out;
}

export function decodeFrame(buffer: Buffer): { header: FrameHeader; payload: Buffer } {
  if (buffer.byteLength < 4) throw new FrameError('帧过短');
  const headerLength = buffer.readUInt32BE(0);
  if (headerLength === 0 || headerLength > 16 * 1024) throw new FrameError('帧头长度非法');
  if (4 + headerLength > buffer.byteLength) throw new FrameError('帧头不完整');
  let header: FrameHeader;
  try {
    header = JSON.parse(buffer.subarray(4, 4 + headerLength).toString('utf8')) as FrameHeader;
  } catch {
    throw new FrameError('帧头不是合法 JSON');
  }
  if (header.v !== 1 || typeof header.channelId !== 'string' || typeof header.to !== 'string') {
    throw new FrameError('帧头字段非法');
  }
  if (!Number.isInteger(header.seq) || header.seq < 1) throw new FrameError('seq 非法');
  const payload = buffer.subarray(4 + headerLength);
  if (payload.byteLength !== header.payloadBytes) throw new FrameError('payload 长度不符');
  if (buffer.byteLength > MAX_FRAME_BYTES) throw new FrameError('帧超过上限');
  return { header, payload };
}
