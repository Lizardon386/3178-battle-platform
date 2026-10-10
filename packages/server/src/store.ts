import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RoomExport } from './room.js';

export const STORE_VERSION = 1;

const CODE_PATTERN = /^[A-Z0-9]{4,12}$/;

/** 房主机上的房间记录。玩家端永远不写这个目录——权威只有一份才说得清谁是房主。 */
export interface StoredRoom {
  v: number;
  gameId: string;
  gameVersion: string;
  rulesHash: string;
  config: Record<string, unknown>;
  room: RoomExport;
  /** 游戏模块自己的 snapshot()；平台不解释其内容。 */
  game: unknown;
}

export interface RestoreReport {
  restored: string[];
  dropped: Array<{ code: string; reason: string }>;
}

export class HostStore {
  constructor(private readonly dir: string) {
    mkdirSync(this.dir, { recursive: true });
  }

  get directory(): string {
    return this.dir;
  }

  /** 房号来自外部文件名的话就是路径注入面，这里先卡死字符集。 */
  private fileFor(code: string): string | null {
    const normalized = code.trim().toUpperCase();
    if (!CODE_PATTERN.test(normalized)) return null;
    return join(this.dir, `room-${normalized}.json`);
  }

  save(entry: StoredRoom): boolean {
    return this.writeFile(entry.room.code, JSON.stringify(entry));
  }

  writeFile(code: string, raw: string): boolean {
    const target = this.fileFor(code);
    if (!target) return false;
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, raw, 'utf8');
    renameSync(tmp, target);
    return true;
  }

  remove(code: string): void {
    const target = this.fileFor(code);
    if (!target || !existsSync(target)) return;
    unlinkSync(target);
  }

  /** 启动时清掉上次崩溃留下的 .tmp，避免下次读到半个文件。 */
  purgeOrphans(): number {
    let purged = 0;
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith('.tmp')) continue;
      unlinkSync(join(this.dir, name));
      purged += 1;
    }
    return purged;
  }

  /** 读不回动的记录直接丢弃并留下原因，别让一房坏数据挡住整个平台启动。 */
  readAll(): { entries: StoredRoom[]; broken: string[] } {
    const entries: StoredRoom[] = [];
    const broken: string[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!/^room-[A-Z0-9]+\.json$/.test(name)) continue;
      const code = name.slice('room-'.length, -'.json'.length);
      try {
        const parsed = JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as StoredRoom;
        if (parsed?.v !== STORE_VERSION || !parsed.room?.code) {
          broken.push(code);
          unlinkSync(join(this.dir, name));
          continue;
        }
        entries.push(parsed);
      } catch {
        broken.push(code);
        unlinkSync(join(this.dir, name));
      }
    }
    return { entries, broken };
  }

  clear(): void {
    for (const name of readdirSync(this.dir)) {
      if (!/^room-[A-Z0-9]+\.json$/.test(name) && !name.endsWith('.tmp')) continue;
      unlinkSync(join(this.dir, name));
    }
  }
}
