export type SessionState = 'open' | 'closing' | 'closed';
export type Presence = 'online' | 'grace';

export interface SessionLimits {
  maxMembers: number;
  maxMessageBytes: number;
  actionsPerSecond: number;
}

export interface MemberRecord {
  memberId: string;
  displayName?: string;
  presence: Presence;
  graceUntil?: number;
  connectionGeneration: number;
}

export interface TicketRecord {
  hash: string;
  memberId: string;
  generation: number;
  previousHash?: string;
  previousUntil?: number;
  revokedAt?: number;
}

export interface SessionRecord {
  schemaVersion: 1;
  sessionId: string;
  code: string;
  gameId: string;
  gameVersion: string;
  ownerMemberId: string;
  members: MemberRecord[];
  tickets: TicketRecord[];
  revision: number;
  state: SessionState;
  createdAt: number;
  limits: SessionLimits;
  metadata?: Record<string, unknown>;
}

export interface CoreError {
  code: string;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: CoreError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(code: string, message: string): Result<T> => ({ ok: false, error: { code, message } });

export const DEFAULT_LIMITS: SessionLimits = {
  maxMembers: 8,
  maxMessageBytes: 64 * 1024,
  actionsPerSecond: 20,
};
