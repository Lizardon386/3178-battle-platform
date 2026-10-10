/**
 * 本机持久化：地址簿（去过的房主）+ 会话票据（座位回座凭据）+ 昵称。
 * 全部走注入的 storage，所以能在 node 里测，也不依赖具体浏览器。
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AddressBookEntry {
  origin: string;
  label: string;
  lastCode: string | null;
  lastSeenAt: number;
  times: number;
}

export interface SessionRecord {
  origin: string;
  roomCode: string;
  seatId: string;
  ticket: string;
  gameId: string;
  savedAt: number;
}

const BOOK_KEY = 'bp.addressbook.v1';
const NICK_KEY = 'bp.nick.v1';
const BOOK_LIMIT = 12;

function readJson<T>(store: KeyValueStore, key: string, fallback: T): T {
  try {
    const raw = store.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class AddressBook {
  constructor(private readonly store: KeyValueStore) {}

  list(): AddressBookEntry[] {
    const entries = readJson<AddressBookEntry[]>(this.store, BOOK_KEY, []);
    return Array.isArray(entries)
      ? entries
          .filter((e) => typeof e?.origin === 'string')
          .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
      : [];
  }

  touch(origin: string, label: string, lastCode: string | null, now: number): AddressBookEntry[] {
    const all = this.list();
    const previous = all.find((e) => e.origin === origin);
    const entry: AddressBookEntry = {
      origin,
      label: label || origin,
      lastCode: lastCode ?? previous?.lastCode ?? null,
      lastSeenAt: now,
      times: (previous?.times ?? 0) + 1,
    };
    const next = [entry, ...all.filter((e) => e.origin !== origin)].slice(0, BOOK_LIMIT);
    this.store.setItem(BOOK_KEY, JSON.stringify(next));
    return next;
  }

  forget(origin: string): void {
    const next = this.list().filter((e) => e.origin !== origin);
    this.store.setItem(BOOK_KEY, JSON.stringify(next));
  }
}

export class NickName {
  constructor(private readonly store: KeyValueStore) {}

  get(): string {
    return readJson<string>(this.store, NICK_KEY, '') || '';
  }

  set(name: string): void {
    this.store.setItem(NICK_KEY, JSON.stringify(name.slice(0, 32)));
  }
}

/** 票据按"房主 + 房号"存，跨房不串；换设备只要导出这条就能继续坐回原位。 */
export class SessionVault {
  private static key(origin: string, code: string): string {
    return `bp.session.v1.${origin}.${code}`;
  }

  constructor(private readonly store: KeyValueStore) {}

  save(origin: string, record: Omit<SessionRecord, 'origin' | 'savedAt'>, now: number): SessionRecord {
    const full: SessionRecord = { ...record, origin, savedAt: now };
    this.store.setItem(SessionVault.key(origin, record.roomCode), JSON.stringify(full));
    return full;
  }

  load(origin: string, code: string): SessionRecord | null {
    return readJson<SessionRecord | null>(this.store, SessionVault.key(origin, code), null);
  }

  clear(origin: string, code: string): void {
    this.store.removeItem(SessionVault.key(origin, code));
  }
}
