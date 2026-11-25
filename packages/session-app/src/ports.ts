import type { SessionRecord } from '@bp/session-core';

export interface OperationRecord {
  key: string;
  payloadHash: string;
  state: 'applied' | 'rejected' | 'unknown';
  resultRef?: string;
  createdAt: number;
}

export interface SessionRepository {
  load(sessionId: string): Promise<SessionRecord | null>;
  save(session: SessionRecord): Promise<void>;
  list(): Promise<SessionRecord[]>;
  getOperation(sessionId: string, key: string): Promise<OperationRecord | null>;
  putOperation(sessionId: string, record: OperationRecord): Promise<void>;
}

export interface Clock {
  now(): number;
}

export interface IdGenerator {
  next(prefix: string): string;
  /** 4–8 位大写字母数字会话码。 */
  code(): string;
}

export interface IssuedSecret {
  secret: string;
  hash: string;
}

export interface SecretStore {
  issue(): IssuedSecret;
  hash(secret: string): string;
}

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface AuthorityLaunch {
  sessionId: string;
  epoch: number;
  roundId: string;
  runtime: string;
  entry: string;
  stateDir: string;
  members: Array<{ memberId: string; displayName?: string }>;
  args?: string[];
  env?: Record<string, string>;
}

/** 平台只通过该端口请求进程，不直接 spawn。 */
export interface AuthoritySupervisor {
  start(launch: AuthorityLaunch): Promise<void>;
  stop(sessionId: string, reason: string): Promise<void>;
  send(sessionId: string, message: Record<string, unknown>): void;
}
