import { build as esbuild } from 'esbuild';
import { copyFile, mkdir, readFile, readdir, lstat, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildPackage, validateManifest, type BuiltPackage } from '@bp/game-package';

export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildError';
  }
}

export interface BuildGameOptions {
  root: string;
  manifestPath?: string;
  authoritySource?: string;
  webSource?: string;
  referenceSource?: string;
  outFile?: string;
  stageDir?: string;
  /** 不指定时取清单的 authorityModel，再退回 process。 */
  authorityModel?: 'process' | 'module';
}

export interface BuildGameResult extends BuiltPackage {
  stageDir: string;
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
};

async function copyTree(from: string, to: string): Promise<void> {
  const info = await lstat(from);
  if (info.isSymbolicLink()) throw new BuildError(`构建输入不能含符号链接：${from}`);
  if (info.isDirectory()) {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      await copyTree(join(from, entry.name), join(to, entry.name));
    }
    return;
  }
  if (info.isFile()) {
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  }
}

async function firstExisting(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

/**
 * 把游戏工程构建成自包含 `.bpkg`：
 * Authority 用 esbuild 打包（平台内运行库一并进包），Web/参考资料按声明路径复制到 stage。
 */
export async function buildGamePackage(options: BuildGameOptions): Promise<BuildGameResult> {
  const root = resolve(options.root);
  const manifestPath = resolve(options.manifestPath ?? join(root, 'game.manifest.json'));
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new BuildError(`读不到或解析不了清单：${manifestPath}（${String(error)}）`);
  }
  const manifest = validateManifest(parsed);
  const authorityModel = options.authorityModel ?? manifest.authorityModel ?? 'process';
  manifest.authorityModel = authorityModel;

  const authority = options.authoritySource
    ? resolve(options.authoritySource)
    : await firstExisting(authorityModel === 'module'
      ? [
        join(root, 'src', 'authority', 'module.ts'),
        join(root, 'src', 'authority', 'index.ts'),
        join(root, 'src', 'authority', 'module.js'),
        join(root, 'src', 'authority', 'index.js'),
      ]
      : [
        join(root, 'src', 'authority', 'process.ts'),
        join(root, 'src', 'authority', 'index.ts'),
        join(root, 'src', 'authority', 'process.js'),
        join(root, 'src', 'authority', 'index.js'),
      ]);
  if (!authority) {
    throw new BuildError('找不到 Authority 源码（默认找 src/authority/process.ts 或 src/authority/index.ts）');
  }

  const stageDir = resolve(options.stageDir ?? join(root, 'dist', 'bpkg-stage'));
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  const authorityOut = join(stageDir, ...manifest.entryPoints.authority.split('/'));
  await mkdir(dirname(authorityOut), { recursive: true });
  await esbuild({
    entryPoints: [authority],
    outfile: authorityOut,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'silent',
  });
  // `.js` + ESM bundle 需要显式 type=module；运行时以独立进程执行该文件。
  await writeFile(join(stageDir, 'package.json'), `${JSON.stringify({ type: 'module', private: true }, null, 2)}\n`, 'utf8');

  const webEntry = manifest.entryPoints.web;
  if (webEntry) {
    const webSource = resolve(options.webSource ?? join(root, 'src', 'web'));
    if (!(await exists(webSource))) throw new BuildError(`找不到 Web 源码目录：${webSource}`);
    const webTarget = dirname(join(stageDir, ...webEntry.split('/')));
    await copyTree(webSource, webTarget);
  }

  const referenceSource = resolve(options.referenceSource ?? join(root, 'src', 'reference.json'));
  if (!(await exists(referenceSource))) throw new BuildError(`找不到参考资料：${referenceSource}`);
  await copyTree(referenceSource, join(stageDir, ...manifest.reference.entry.split('/')));

  await writeFile(join(stageDir, 'game.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const outFile = resolve(options.outFile ?? join(root, 'dist', `${manifest.id}-${manifest.version}.bpkg`));
  const built = buildPackage({ root: stageDir, manifest, outFile });
  return { ...built, stageDir };
}
