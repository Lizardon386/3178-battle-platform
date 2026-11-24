export interface DeliveryItem {
  to: string;
  payload: unknown;
  viewSeq?: number;
}

export interface AuthorityContext {
  now(): number;
  random(): number;
  ready(): void;
  deliver(items: DeliveryItem[]): void;
  roundClosed(payload: unknown): void;
  fail(code: string, text: string, fatal?: boolean): void;
  checkpoint(): Promise<void>;
}

export interface MemberEvent {
  memberId: string;
  [key: string]: unknown;
}

export interface AuthorityHooks {
  start(message: Record<string, unknown>, restored: unknown, context: AuthorityContext): void | Promise<void>;
  deliver(message: Record<string, unknown>, context: AuthorityContext): void | Promise<void>;
  sync?(message: Record<string, unknown>, context: AuthorityContext): void | Promise<void>;
  memberJoin?(message: Record<string, unknown>, context: AuthorityContext): void | Promise<void>;
  memberLeave?(message: Record<string, unknown>, context: AuthorityContext): void | Promise<void>;
  memberResume?(message: Record<string, unknown>, context: AuthorityContext): void | Promise<void>;
  memberUpdate?(message: Record<string, unknown>, context: AuthorityContext): void | Promise<void>;
  hostChanged?(message: Record<string, unknown>, context: AuthorityContext): void | Promise<void>;
  closeSession?(message: Record<string, unknown>, context: AuthorityContext): void | Promise<void>;
  snapshot?(): unknown;
  validateSnapshot?(value: unknown): boolean;
}

export interface Transport {
  send(message: unknown): void;
}

export interface RuntimeMember {
  memberId: string;
  displayName?: string;
}

export interface RuntimeOptions {
  hooks: AuthorityHooks;
  transport: Transport;
  stateDir: string;
  sessionId: string;
  epoch: number;
  roundId: string;
  members?: RuntimeMember[];
  seed?: number;
}
