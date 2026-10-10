import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GameModule } from './module-api.js';

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

export async function loadGame(gamesRoot: string, id: string): Promise<GameModule> {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) throw new Error(`非法游戏 id：${id}`);
  const entry = join(gamesRoot, id, 'dist', 'index.js');
  if (!existsSync(entry)) throw new Error(`找不到游戏模块入口：${entry}`);
  const loaded = (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
  const found = pickExport(loaded);
  if (!found) throw new Error(`${id} 没有导出符合 GameModule 契约的对象`);
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
