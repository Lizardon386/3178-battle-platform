import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { OperationRecord, SessionRepository } from '@bp/session-app';
import type { SessionRecord } from '@bp/session-core';
import { atomicWriteJson } from './atomic-write.js';
import { SessionWal } from './wal.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface FileRepositoryOptions {
  root: string;
}

/** 每个会话一个目录：session.json + session.wal + operations.jsonl。 */
export class FileSessionRepository implements SessionRepository {
  private readonly sessionsDir: string;
  private readonly operationsCache = new Map<string, Map<string, OperationRecord>>();
  private readonly writeQueues = new Map<string, Promise<unknown>>();

  constructor(options: FileRepositoryOptions) {
    this.sessionsDir = join(options.root, 'sessions');
  }

  private dirFor(sessionId: string): string {
    if (!ID_PATTERN.test(sessionId)) throw new Error(`非法 sessionId: ${sessionId}`);
    return join(this.sessionsDir, sessionId);
  }

  private walFor(sessionId: string): SessionWal {
    return new SessionWal(join(this.dirFor(sessionId), 'session.wal'));
  }

  /** 同一会话的写入串行化：WAL 追加和原子写不能交错，否则 rename 会互相踩。 */
  private enqueue<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.writeQueues.get(sessionId) ?? Promise.resolve();
    const current = previous.then(task, task);
    this.writeQueues.set(sessionId, current.then(() => undefined, () => undefined));
    return current;
  }

  save(session: SessionRecord): Promise<void> {
    return this.enqueue(session.sessionId, async () => {
      const dir = this.dirFor(session.sessionId);
      await mkdir(dir, { recursive: true });
      await this.walFor(session.sessionId).append({ kind: 'session', body: session });
      await atomicWriteJson(join(dir, 'session.json'), session);
    });
  }

  async load(sessionId: string): Promise<SessionRecord | null> {
    const file = join(this.dirFor(sessionId), 'session.json');
    try {
      const raw = await readFile(file, 'utf8');
      const session = JSON.parse(raw) as SessionRecord;
      if (session.schemaVersion !== 1 || session.sessionId !== sessionId) return null;
      return session;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async list(): Promise<SessionRecord[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.sessionsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const sessions: SessionRecord[] = [];
    for (const name of names) {
      if (!ID_PATTERN.test(name)) continue;
      const session = await this.load(name);
      if (session) sessions.push(session);
    }
    return sessions;
  }

  private async operations(sessionId: string): Promise<Map<string, OperationRecord>> {
    const cached = this.operationsCache.get(sessionId);
    if (cached) return cached;
    const map = new Map<string, OperationRecord>();
    const file = join(this.dirFor(sessionId), 'operations.jsonl');
    try {
      const raw = await readFile(file, 'utf8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line) as OperationRecord;
          if (record?.key) map.set(record.key, record);
        } catch {
          // 半条记录忽略；结果由后续操作覆盖。
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.operationsCache.set(sessionId, map);
    return map;
  }

  async getOperation(sessionId: string, key: string): Promise<OperationRecord | null> {
    return (await this.operations(sessionId)).get(key) ?? null;
  }

  putOperation(sessionId: string, record: OperationRecord): Promise<void> {
    return this.enqueue(sessionId, async () => {
      const dir = this.dirFor(sessionId);
      await mkdir(dir, { recursive: true });
      await appendFile(join(dir, 'operations.jsonl'), JSON.stringify(record) + '\n', 'utf8');
      (await this.operations(sessionId)).set(record.key, record);
    });
  }
}
