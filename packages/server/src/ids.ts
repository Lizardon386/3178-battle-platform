import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 去掉 I O 0 1 的房号字母表：房号要在群里念出来、手打进加入框，
 * 这是可用性约束，不是审美。
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;

export function roomCode(existing?: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const bytes = randomBytes(CODE_LENGTH);
    let code = '';
    for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    if (!existing || !existing(code)) return code;
  }
  throw new Error('房号空间已满，请关掉一些闲置房间');
}

export function newSeatId(): string {
  return `s${randomBytes(5).toString('hex')}`;
}

/** 连接 id：只在本机进程内有效，不上线。 */
export function newConnId(): string {
  return `c${randomBytes(6).toString('hex')}`;
}

/** 入席票据：只有拿到它的设备能 reclaim 这个座位。 */
export function newTicket(): string {
  return randomBytes(18).toString('base64url');
}

/** 票据与房间密码共用同一套摘要原语。 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function secretMatches(storedHash: string | null, presented: string): boolean {
  if (!storedHash || presented.length === 0) return false;
  const presentedHash = hashSecret(presented);
  if (presentedHash.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(presentedHash, 'hex'), Buffer.from(storedHash, 'hex'));
}

export function nonce(): string {
  return randomBytes(8).toString('base64url');
}
