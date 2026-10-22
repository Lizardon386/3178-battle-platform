import { FEED_EVENT, type FeedEntry } from '../shared.js';

export interface FeedEvent {
  name: string;
  payload?: unknown;
}

export interface FeedPanelOptions {
  mount?: HTMLElement;
  max?: number;
  /** 只显示这些 type；不填表示全部。 */
  types?: readonly string[];
  maxText?: number;
  emptyText?: string;
  timeFormat?: (at: number) => string;
  /** 给 actor 上色；不填则用默认文本色。 */
  colorOf?: (seatId: string) => string | null;
  /** 只给新到的事件回调；初始历史不会触发。 */
  onEntry?: (entry: FeedEntry) => void;
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function formatFeedTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function normalizeFeedEntry(value: unknown): FeedEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Number.isSafeInteger(raw.seq) || (raw.seq as number) < 1) return null;
  if (typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return null;
  if (typeof raw.type !== 'string' || raw.type.trim().length === 0) return null;
  if (typeof raw.text !== 'string' || raw.text.trim().length === 0) return null;
  if (raw.actor !== undefined && typeof raw.actor !== 'string') return null;
  if (raw.target !== undefined && typeof raw.target !== 'string') return null;
  if (raw.data !== undefined && (typeof raw.data !== 'object' || raw.data === null || Array.isArray(raw.data))) return null;
  const text = raw.text.trim();
  if (text.length === 0) return null;
  const entry: FeedEntry = {
    seq: raw.seq as number,
    at: raw.at,
    type: raw.type.trim(),
    text,
  };
  if (raw.actor !== undefined) entry.actor = raw.actor;
  if (raw.target !== undefined) entry.target = raw.target;
  if (raw.data !== undefined) entry.data = raw.data as Record<string, unknown>;
  return entry;
}

/** 按 seq 合并，保留最近的 max 条；重复帧不会重复显示。 */
export function mergeFeedEntries(
  current: readonly FeedEntry[],
  incoming: readonly FeedEntry[],
  max: number,
): FeedEntry[] {
  const bySeq = new Map<number, FeedEntry>();
  for (const entry of current) bySeq.set(entry.seq, entry);
  for (const entry of incoming) bySeq.set(entry.seq, entry);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-Math.max(1, max));
}

/** 渲染无关的事件流面板；不挂 mount 时只跑回调和状态。 */
export class FeedPanel {
  private readonly options: FeedPanelOptions;
  private readonly max: number;
  private readonly maxText: number;
  private readonly list: HTMLOListElement | null = null;
  private entries: FeedEntry[] = [];

  constructor(options: FeedPanelOptions = {}) {
    this.options = options;
    this.max = clamp(options.max, 1, 500, 100);
    this.maxText = clamp(options.maxText, 1, 2_000, 240);
    if (options.mount) {
      const list = options.mount.ownerDocument.createElement('ol');
      list.className = 'bp-feed';
      list.setAttribute('role', 'log');
      list.setAttribute('aria-live', 'polite');
      list.setAttribute('aria-relevant', 'additions');
      list.style.cssText = [
        'margin:0',
        'padding:2px 8px',
        'max-height:240px',
        'overflow-y:auto',
        'list-style:none',
        'font:12px/1.6 system-ui, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
      ].join(';');
      options.mount.replaceChildren(list);
      this.list = list;
    }
  }

  setEntries(entries: readonly FeedEntry[]): void {
    const normalized = entries.map(normalizeFeedEntry).filter((entry): entry is FeedEntry => entry !== null);
    this.entries = mergeFeedEntries([], normalized, this.max);
    this.render();
  }

  append(entry: FeedEntry): void {
    const normalized = normalizeFeedEntry(entry);
    if (!normalized || this.entries.some((item) => item.seq === normalized.seq)) return;
    this.entries = mergeFeedEntries(this.entries, [normalized], this.max);
    this.render();
    this.options.onEntry?.(normalized);
  }

  /** 直接接 GameClient.onEvent；不是 bp.feed 时返回 false。 */
  handleEvent(event: FeedEvent): boolean {
    if (event.name !== FEED_EVENT) return false;
    const payloads = Array.isArray(event.payload) ? event.payload : [event.payload];
    for (const payload of payloads) this.append(payload as FeedEntry);
    return true;
  }

  clear(): void {
    this.entries = [];
    this.render();
  }

  destroy(): void {
    this.options.mount?.replaceChildren();
    this.entries = [];
  }

  private render(): void {
    const list = this.list;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 8;
    const allowed = this.options.types ? new Set(this.options.types) : null;
    const visible = this.entries.filter((entry) => !allowed || allowed.has(entry.type));
    list.replaceChildren();
    if (visible.length === 0) {
      const empty = list.ownerDocument.createElement('li');
      empty.className = 'bp-feed-empty';
      empty.textContent = this.options.emptyText ?? '暂无事件';
      empty.style.cssText = 'padding:4px 0;opacity:.55';
      list.append(empty);
      return;
    }
    for (const entry of visible) {
      const item = list.ownerDocument.createElement('li');
      item.className = 'bp-feed-item';
      item.dataset.type = entry.type;
      item.style.cssText = 'display:flex;gap:8px;padding:1px 0;align-items:baseline';
      const time = list.ownerDocument.createElement('time');
      time.className = 'bp-feed-time';
      time.dateTime = new Date(entry.at).toISOString();
      time.textContent = (this.options.timeFormat ?? formatFeedTime)(entry.at);
      time.style.cssText = 'flex:none;opacity:.55;font-variant-numeric:tabular-nums';
      const text = list.ownerDocument.createElement('span');
      text.className = 'bp-feed-text';
      text.textContent = entry.text.length > this.maxText ? `${entry.text.slice(0, this.maxText)}…` : entry.text;
      text.style.cssText = 'min-width:0;overflow-wrap:anywhere';
      if (entry.actor && this.options.colorOf) {
        const color = this.options.colorOf(entry.actor);
        if (color) text.style.color = color;
      }
      item.append(time, text);
      list.append(item);
    }
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }
}
