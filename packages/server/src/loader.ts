import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GameAsset } from '@bp/protocol';
import type { GameModule } from './module-api.js';
import { extractPack, listPackFiles, readPack } from '@bp/game-sdk/node';

/**
 * 游戏模块在运行时按 id 动态加载——平台源码里不许 import 任何 games/ 路径，
 * 否则"无关玩法"就只是一句口号（见 tools/check-seam.sh）。
 */
export function isGameModule(value: unknown): value is GameModule {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  const needed = ['id', 'name', 'version', 'entry'];
  if (!needed.every((k) => typeof m[k] === 'string')) return false;
  if (typeof m.normalizeConfig !== 'function' || typeof m.rulesHashOf !== 'function') return false;
  if (typeof m.create !== 'function' || typeof m.resume !== 'function') return false;
  const seats = m.seats as { min?: unknown; max?: unknown } | undefined;
  return typeof seats?.min === 'number' && typeof seats?.max === 'number';
}

function pickExport(loaded: Record<string, unknown>): GameModule | null {
  if (isGameModule(loaded.default)) return loaded.default;
  for (const value of Object.values(loaded)) {
    if (isGameModule(value)) return value;
  }
  return null;
}

async function importModule(entry: string): Promise<GameModule> {
  const loaded = (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
  const found = pickExport(loaded);
  if (!found) throw new Error(`${entry} 没有导出符合 GameModule 契约的对象`);
  return found;
}

export async function loadGame(gamesRoot: string, id: string): Promise<GameModule> {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) throw new Error(`非法游戏 id：${id}`);
  const entry = join(gamesRoot, id, 'dist', 'index.js');
  if (!existsSync(entry)) throw new Error(`找不到游戏模块入口：${entry}`);
  const found = await importModule(entry);
  if (found.id !== id) throw new Error(`${id} 目录里的模块自称 ${found.id}`);
  return found;
}

export async function loadGames(gamesRoot: string): Promise<GameModule[]> {
  if (!existsSync(gamesRoot)) return [];
  const found: GameModule[] = [];
  for (const name of readdirSync(gamesRoot, { withFileTypes: true })) {
    if (!name.isDirectory() || name.name.startsWith('.')) continue;
    if (!existsSync(join(gamesRoot, name.name, 'dist', 'index.js'))) continue;
    found.push(await loadGame(gamesRoot, name.name));
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

export interface GameSource {
  module: GameModule;
  root: string;
  packageHash?: string;
  assets: GameAsset[];
}

export interface GameLoadError {
  source: string;
  message: string;
}

export interface GameSet {
  modules: GameModule[];
  roots: Map<string, string>;
  assets: Map<string, GameAsset[]>;
  errors: GameLoadError[];
}

/** 读包、解包、加载包内服务端入口；版本字符串带包哈希，避免两个不同包同版本混用。 */
export async function loadPackGame(packPath: string, cacheRoot: string): Promise<GameSource> {
  const pack = readPack(packPath);
  const extracted = extractPack(pack, cacheRoot);
  const entry = join(extracted.dir, ...pack.manifest.server.split('/'));
  if (!existsSync(entry)) throw new Error(`包内服务端入口不存在：${pack.manifest.server}`);
  const module = await importModule(entry);
  if (module.id !== pack.manifest.id) {
    throw new Error(`包声明 id ${pack.manifest.id}，模块自称 ${module.id}`);
  }
  if (module.version !== pack.manifest.version) {
    throw new Error(`包声明版本 ${pack.manifest.version}，模块自称 ${module.version}`);
  }
  return {
    module: { ...module, version: `${module.version}+${pack.packageHash.slice(0, 12)}` },
    root: extracted.dir,
    packageHash: pack.packageHash,
    assets: pack.manifest.files.map((file) => ({
      path: file.path,
      hash: `sha256:${file.sha256}`,
      bytes: file.size,
    })),
  };
}

/**
 * 目录游戏与单文件包一起加载。坏包只记错误、不挡启动；同 id 的包不覆盖已加载的游戏。
 */
export async function loadGameSet(gamesRoot: string, cacheRoot: string): Promise<GameSet> {
  const modules: GameModule[] = [];
  const roots = new Map<string, string>();
  const assets = new Map<string, GameAsset[]>();
  const errors: GameLoadError[] = [];

  for (const module of await loadGames(gamesRoot)) {
    modules.push(module);
    roots.set(module.id, join(gamesRoot, module.id));
  }

  for (const packPath of listPackFiles(gamesRoot)) {
    try {
      const loaded = await loadPackGame(packPath, cacheRoot);
      if (roots.has(loaded.module.id)) {
        errors.push({ source: packPath, message: `游戏 id ${loaded.module.id} 与已加载的游戏重复，已跳过这个包` });
        continue;
      }
      modules.push(loaded.module);
      roots.set(loaded.module.id, loaded.root);
      assets.set(loaded.module.id, loaded.assets);
    } catch (error) {
      errors.push({ source: packPath, message: error instanceof Error ? error.message : String(error) });
    }
  }

  modules.sort((a, b) => a.id.localeCompare(b.id));
  return { modules, roots, assets, errors };
}
