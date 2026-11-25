import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { GameManifest } from './manifest.js';
import { extractPackage, PACKAGE_EXTENSION, readPackage, type LoadedPackage } from './pack.js';

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

export interface GameWebEntry {
  /** Web 入口所在目录，作为游戏 origin 的静态根。 */
  root: string;
  /** 访问 `/s/<sessionId>/` 时返回的文件名。 */
  entry: string;
}

export type AuthorityRuntimeKind = 'node' | 'python';

export interface RegisteredGame {
  manifest: GameManifest;
  packageHash: string;
  source: string;
  /** 解包后的包根目录。 */
  root: string;
  authorityEntry: string;
  /** 由 Authority 入口扩展名推断；`.py` 走 Python，其余走 Node。 */
  runtime: AuthorityRuntimeKind;
  web: GameWebEntry | null;
}

export interface GameListEntry {
  id: string;
  name: string;
  versions: string[];
}

export interface GameRegistryEntry {
  id: string;
  name: string;
  version: string;
  manifest: GameManifest;
}

function fail(message: string): never {
  throw new RegistryError(message);
}

const asFile = (path: string, label: string): string => {
  let info;
  try {
    info = statSync(path);
  } catch {
    fail(`${label}不存在：${path}`);
  }
  if (!info.isFile()) fail(`${label}不是文件：${path}`);
  return path;
};

function register(pack: LoadedPackage, root: string): RegisteredGame {
  const { manifest } = pack;
  const authorityEntry = asFile(join(root, ...manifest.entryPoints.authority.split('/')), 'Authority 入口');
  const webEntry = manifest.entryPoints.web;
  const web = webEntry === undefined
    ? null
    : (() => {
      const file = asFile(join(root, ...webEntry.split('/')), 'Web 入口');
      return { root: dirname(file), entry: basename(file) };
    })();
  return {
    manifest,
    packageHash: pack.packageHash,
    source: pack.source,
    root,
    authorityEntry,
    runtime: authorityEntry.toLowerCase().endsWith('.py') ? 'python' : 'node',
    web,
  };
}

/** 版本比较：数字段按数值比较，其余按字典序；空版本时取“最高版本”。 */
function compareVersions(a: string, b: string): number {
  const left = a.split(/[.-]/);
  const right = b.split(/[.-]/);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i];
    const r = right[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const ln = Number(l);
    const rn = Number(r);
    if (Number.isFinite(ln) && Number.isFinite(rn)) return ln - rn;
    return l < r ? -1 : 1;
  }
  return 0;
}

export class GameRegistry {
  private readonly byKey = new Map<string, RegisteredGame>();
  private readonly byId = new Map<string, RegisteredGame[]>();

  constructor(games: RegisteredGame[]) {
    for (const game of games) {
      const key = `${game.manifest.id}@${game.manifest.version}`;
      const existing = this.byKey.get(key);
      if (existing) {
        fail(`重复注册游戏 ${key}：${existing.source} 与 ${game.source}`);
      }
      this.byKey.set(key, game);
      const list = this.byId.get(game.manifest.id) ?? [];
      list.push(game);
      this.byId.set(game.manifest.id, list);
    }
    for (const list of this.byId.values()) list.sort((a, b) => compareVersions(a.manifest.version, b.manifest.version));
  }

  /** 精确匹配 id + version；version 为空时返回最高版本。 */
  resolve(gameId: string, gameVersion = ''): RegisteredGame | null {
    if (gameVersion) return this.byKey.get(`${gameId}@${gameVersion}`) ?? null;
    const list = this.byId.get(gameId);
    return list === undefined || list.length === 0 ? null : list[list.length - 1] ?? null;
  }

  list(): GameListEntry[] {
    return [...this.byId.entries()]
      .map(([id, games]) => ({
        id,
        name: games[0]?.manifest.name ?? id,
        versions: games.map((game) => game.manifest.version),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** 按 id、版本排序的完整条目，供 `gameList` 一次性返回。 */
  entries(): GameRegistryEntry[] {
    return [...this.byKey.values()]
      .map((game) => ({
        id: game.manifest.id,
        name: game.manifest.name,
        version: game.manifest.version,
        manifest: game.manifest,
      }))
      .sort((a, b) => (a.id === b.id
        ? compareVersions(a.version, b.version)
        : (a.id < b.id ? -1 : 1)));
  }

  get size(): number {
    return this.byKey.size;
  }
}

export interface OpenGameRegistryOptions {
  /** 显式列出的 `.bpkg` 文件。 */
  packages?: string[];
  /** 扫描目录下的所有 `.bpkg` 文件。 */
  directories?: string[];
  /** 解包缓存根，通常是 `<dataDir>/packages`。 */
  cacheRoot: string;
}

/** 读取、校验并解包所有已注册游戏；任何一个坏包都让启动失败，而不是静默跳过。 */
export function openGameRegistry(options: OpenGameRegistryOptions): GameRegistry {
  const files: string[] = [];
  for (const file of options.packages ?? []) {
    files.push(asFile(file, '游戏包'));
  }
  for (const directory of options.directories ?? []) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      fail(`读不到游戏包目录：${directory}`);
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(PACKAGE_EXTENSION)) {
        files.push(join(directory, entry.name));
      }
    }
  }

  const games: RegisteredGame[] = [];
  for (const file of files) {
    const pack = readPackage(file);
    const extracted = extractPackage(pack, options.cacheRoot);
    games.push(register(pack, extracted.dir));
  }
  return new GameRegistry(games);
}
