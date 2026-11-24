/**
 * 游戏侧 compile-only stub：只有类型与契约，没有运行时实现。
 * 构建时用 --external 排除，运行时由平台注入。临时包名将在 WP9 替换为 @lizardon386/game-sdk。
 */

export type ClientKind = 'native' | 'web' | 'mobile';

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

export interface GameClient {
  send(payload: unknown, options?: { operationId?: string; roundId?: string }): string;
  sync(afterViewSeq?: number): Promise<void>;
  close(): void;
}
