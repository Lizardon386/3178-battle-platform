import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { canonicalJson } from '@bp/protocol-contract';

export interface WalEntryInput {
  kind: string;
  operationKey?: string;
  body: unknown;
}

export interface WalEntry extends WalEntryInput {
  seq: number;
  prevHash: string;
  hash: string;
}

const GENESIS = '0'.repeat(64);

function hashOf(entry: Omit<WalEntry, 'hash'>): string {
  return createHash('sha256').update(canonicalJson(entry), 'utf8').digest('hex');
}

/** 追加式 WAL：每条带前序哈希；读取时截断到最后一条完整有效记录。 */
export class SessionWal {
  constructor(private readonly file: string) {}

  async read(): Promise<{ entries: WalEntry[]; dropped: number }> {
    let raw = '';
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [], dropped: 0 };
      throw error;
    }
    const lines = raw.split('\n').filter((line) => line.trim().length > 0);
    const entries: WalEntry[] = [];
    let prevHash = GENESIS;
    let dropped = 0;
    for (const [index, line] of lines.entries()) {
      let parsed: WalEntry;
      try {
        parsed = JSON.parse(line) as WalEntry;
      } catch {
        dropped = lines.length - index;
        break;
      }
      const expected = hashOf({
        seq: parsed.seq,
        prevHash: parsed.prevHash,
        kind: parsed.kind,
        ...(parsed.operationKey === undefined ? {} : { operationKey: parsed.operationKey }),
        body: parsed.body,
      });
      if (parsed.seq !== entries.length + 1 || parsed.prevHash !== prevHash || parsed.hash !== expected) {
        dropped = lines.length - index;
        break;
      }
      entries.push(parsed);
      prevHash = parsed.hash;
    }
    return { entries, dropped };
  }

  async append(input: WalEntryInput): Promise<WalEntry> {
    const { entries } = await this.read();
    const prevHash = entries.length === 0 ? GENESIS : entries[entries.length - 1]!.hash;
    const base = {
      seq: entries.length + 1,
      prevHash,
      kind: input.kind,
      ...(input.operationKey === undefined ? {} : { operationKey: input.operationKey }),
      body: input.body,
    };
    const entry: WalEntry = { ...base, hash: hashOf(base) };
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, JSON.stringify(entry) + '\n', 'utf8');
    return entry;
  }

  /** 把文件重写为最后一段有效记录，丢弃半条或坏哈希尾部。 */
  async repair(): Promise<{ kept: number; dropped: number }> {
    const { entries, dropped } = await this.read();
    if (dropped > 0 || entries.length === 0) {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file, entries.map((entry) => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : ''), 'utf8');
    }
    return { kept: entries.length, dropped };
  }
}
