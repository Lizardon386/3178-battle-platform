import type { Effect, ViewerId } from '@3178/core-abi';
import { FEED_EVENT, FeedError, type FeedEntry, type FeedVisibility } from '../shared.js';

export interface FeedSeat {
  seatId: string;
  team: string | number | null;
}

export interface FeedLogOptions {
  max?: number;
  maxText?: number;
  now?: () => number;
  /** team 可见性用；返回当前所有座位及其队伍。 */
  seatTeams?: () => ReadonlyArray<FeedSeat>;
}

export interface FeedEmitInput {
  type: string;
  text: string;
  actor?: string;
  target?: string;
  data?: Record<string, unknown>;
  visibility?: FeedVisibility;
  at?: number;
}

interface StoredEntry extends FeedEntry {
  visibility: FeedVisibility;
}

const MAX_TYPE_LENGTH = 64;
const MAX_DATA_JSON = 2_000;

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function validateVisibility(value: FeedVisibility | undefined): FeedVisibility {
  if (value === undefined || value === 'all') return 'all';
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FeedError('事件可见性必须是 all、{ seatId } 或 { team }');
  }
  const keys = Object.keys(value);
  if (keys.length !== 1) throw new FeedError('事件可见性只能包含 seatId 或 team');
  if (keys[0] === 'seatId') {
    const seatId = (value as { seatId?: unknown }).seatId;
    if (typeof seatId !== 'string' || seatId.length === 0) throw new FeedError('事件 seatId 不合法');
    return { seatId };
  }
  if (keys[0] === 'team') {
    const team = (value as { team?: unknown }).team;
    if (typeof team !== 'string' && (typeof team !== 'number' || !Number.isFinite(team))) {
      throw new FeedError('事件 team 不合法');
    }
    return { team };
  }
  throw new FeedError('事件可见性只能包含 seatId 或 team');
}

function publicEntry(entry: StoredEntry): FeedEntry {
  const copy: FeedEntry = {
    seq: entry.seq,
    at: entry.at,
    type: entry.type,
    text: entry.text,
  };
  if (entry.actor !== undefined) copy.actor = entry.actor;
  if (entry.target !== undefined) copy.target = entry.target;
  if (entry.data !== undefined) copy.data = entry.data;
  return copy;
}

function validateEntry(value: unknown): StoredEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Number.isSafeInteger(raw.seq) || (raw.seq as number) < 1) return null;
  if (typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return null;
  if (typeof raw.type !== 'string' || raw.type.trim().length === 0 || raw.type.length > MAX_TYPE_LENGTH) return null;
  if (typeof raw.text !== 'string' || raw.text.length === 0) return null;
  if (raw.actor !== undefined && typeof raw.actor !== 'string') return null;
  if (raw.target !== undefined && typeof raw.target !== 'string') return null;
  if (raw.data !== undefined && (typeof raw.data !== 'object' || raw.data === null || Array.isArray(raw.data))) return null;
  let visibility: FeedVisibility;
  try {
    visibility = validateVisibility(raw.visibility as FeedVisibility | undefined);
  } catch {
    return null;
  }
  const entry: StoredEntry = {
    seq: raw.seq as number,
    at: raw.at,
    type: raw.type.trim(),
    text: raw.text,
    visibility,
  };
  if (raw.actor !== undefined) entry.actor = raw.actor;
  if (raw.target !== undefined) entry.target = raw.target;
  if (raw.data !== undefined) entry.data = raw.data as Record<string, unknown>;
  return entry;
}

/** 服务端事件流水：生成序号/时间、按可见性发 Effect、保留最近 N 条。 */
export class FeedLog {
  private readonly max: number;
  private readonly maxText: number;
  private readonly now: () => number;
  private readonly seatTeams: (() => ReadonlyArray<FeedSeat>) | null;
  private entries: StoredEntry[] = [];
  private nextSeq = 1;
  private pending: Effect[] = [];

  constructor(options: FeedLogOptions = {}) {
    this.max = clamp(options.max, 1, 500, 100);
    this.maxText = clamp(options.maxText, 1, 2_000, 200);
    this.now = options.now ?? (() => Date.now());
    this.seatTeams = options.seatTeams ?? null;
  }

  emit(input: FeedEmitInput): FeedEntry {
    const type = typeof input.type === 'string' ? input.type.trim() : '';
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!type || type.length > MAX_TYPE_LENGTH) throw new FeedError('事件 type 为空或过长');
    if (!text) throw new FeedError('事件 text 不能为空');
    const visibility = validateVisibility(input.visibility);

    let recipients: string[] = [];
    if (typeof visibility === 'object' && 'team' in visibility) {
      if (!this.seatTeams) throw new FeedError('team 可见性需要 seatTeams 选项');
      recipients = [...new Set(
        this.seatTeams()
          .filter((seat) => seat.team === visibility.team)
          .map((seat) => seat.seatId),
      )];
    }

    const at = typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : this.now();
    const entry: StoredEntry = {
      seq: this.nextSeq,
      at,
      type,
      text: text.slice(0, this.maxText),
      visibility,
    };
    if (input.actor) entry.actor = input.actor;
    if (input.target) entry.target = input.target;
    if (input.data) {
      const json = JSON.stringify(input.data);
      if (json.length > MAX_DATA_JSON) throw new FeedError('事件 data 过大');
      entry.data = input.data;
    }
    this.nextSeq += 1;
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);

    const payload = publicEntry(entry);
    if (visibility === 'all') {
      this.pending.push({ kind: 'broadcast', name: FEED_EVENT, payload });
    } else if ('seatId' in visibility) {
      this.pending.push({ kind: 'toSeat', seatId: visibility.seatId, name: FEED_EVENT, payload });
    } else {
      for (const seatId of recipients) {
        this.pending.push({ kind: 'toSeat', seatId, name: FEED_EVENT, payload });
      }
    }
    return payload;
  }

  /** 按视角裁剪历史；viewer 为 null 时只返回全员事件。 */
  viewFor(viewer: ViewerId): FeedEntry[] {
    const viewerTeam = viewer !== null && this.seatTeams
      ? this.seatTeams().find((seat) => seat.seatId === viewer)?.team ?? null
      : null;
    return this.entries
      .filter((entry) => {
        if (entry.visibility === 'all') return true;
        if (viewer === null) return false;
        if ('seatId' in entry.visibility) return entry.visibility.seatId === viewer;
        return viewerTeam !== null && entry.visibility.team === viewerTeam;
      })
      .map(publicEntry);
  }

  drainEffects(): Effect[] {
    const effects = this.pending;
    this.pending = [];
    return effects;
  }

  clear(): void {
    this.entries = [];
    this.pending = [];
    this.nextSeq = 1;
  }

  snapshot(): unknown {
    return {
      version: 1,
      nextSeq: this.nextSeq,
      entries: this.entries.map((entry) => ({ ...entry, data: entry.data ? { ...entry.data } : undefined })),
    };
  }

  restore(value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FeedError('事件流快照不合法');
    const raw = value as { version?: unknown; nextSeq?: unknown; entries?: unknown };
    if (raw.version !== 1 || !Array.isArray(raw.entries)) throw new FeedError('事件流快照版本不支持');
    const entries: StoredEntry[] = [];
    for (const item of raw.entries) {
      const entry = validateEntry(item);
      if (!entry) throw new FeedError('事件流快照含坏记录');
      entries.push(entry);
    }
    entries.sort((a, b) => a.seq - b.seq);
    this.entries = entries.slice(-this.max);
    const maxSeq = this.entries.reduce((max, entry) => Math.max(max, entry.seq), 0);
    const savedNext = typeof raw.nextSeq === 'number' && Number.isSafeInteger(raw.nextSeq) ? raw.nextSeq : 1;
    this.nextSeq = Math.max(savedNext, maxSeq + 1, 1);
    this.pending = [];
  }
}
