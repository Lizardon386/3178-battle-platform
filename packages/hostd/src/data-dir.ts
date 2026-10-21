import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const PORTABLE_MARKER = '.portable-build.json';
const APP_DIR_NAME = '3178-battle-platform';

/**
 * 数据目录的落点。
 *
 * 便携包（根目录带 `.portable-build.json`，由 tools/devtools/build-portable.mjs 写入）把数据放到
 * 用户目录：整个程序目录会被新版本直接替换掉，数据留在里面会在更新时一起消失。
 * 开发目录没有这个标记，数据仍跟着仓库走，方便测试和清理。
 *
 * `BP_DATA_DIR` 优先于以上两条，供测试与临时目录使用。
 */
export function resolveDataDir(root: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.BP_DATA_DIR) return resolve(env.BP_DATA_DIR);
  if (!existsSync(join(root, PORTABLE_MARKER))) return join(root, 'data');
  const base = env.LOCALAPPDATA ?? env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return join(base, APP_DIR_NAME, 'data');
}

/** 给人看的一句话：说明当前落点为什么是这里。 */
export function dataDirNote(root: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.BP_DATA_DIR) return '（BP_DATA_DIR 指定）';
  if (existsSync(join(root, PORTABLE_MARKER))) return '（便携包：数据放在用户目录，更新程序目录不会丢）';
  return '（开发目录：数据跟着仓库走）';
}
