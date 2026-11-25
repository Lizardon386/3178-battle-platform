#!/usr/bin/env node
/**
 * win-x64 便携产物：C# 原生 exe + 官方 node.exe + Session Service 单文件 bundle + 管理端静态页。
 * 不做安装器；Inno Setup 脚本在 tools/packaging/inno/setup.iss。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_ROOT = resolve(process.env.BP_PACK_OUT ?? join(REPO, 'dist-win'));
const APP = join(OUT_ROOT, '3178');

const dotnet = process.env.BP_DOTNET
  ?? (existsSync(join(REPO, 'dogfood-output', 'dotnet', 'dotnet.exe'))
    ? join(REPO, 'dogfood-output', 'dotnet', 'dotnet.exe')
    : 'dotnet');

function run(command, args, label) {
  const env = { ...process.env };
  if (existsSync(dotnet)) env.DOTNET_ROOT = dirname(dotnet);
  const result = spawnSync(command, args, {
    cwd: REPO,
    stdio: 'inherit',
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label}失败（exit=${result.status}）`);
}

async function sha256(file) {
  const hash = createHash('sha256');
  hash.update(await readFile(file));
  return hash.digest('hex');
}

async function publish(project, output) {
  await rm(output, { recursive: true, force: true });
  run(dotnet, [
    'publish', project,
    '-c', 'Release',
    '-r', 'win-x64',
    '--self-contained', 'true',
    '-p:PublishSingleFile=true',
    '-p:IncludeNativeLibrariesForSelfExtract=true',
    '-p:DebugType=None',
    '-o', output,
  ], `dotnet publish ${project}`);
}

async function copyExe(fromDir, name, toDir, targetName = name) {
  const source = join(fromDir, name);
  if (!existsSync(source)) {
    const files = existsSync(fromDir) ? await readdir(fromDir) : [];
    throw new Error(`没有找到 ${name}；目录内容：${files.join(', ')}`);
  }
  await copyFile(source, join(toDir, targetName));
}

async function main() {
  if (process.platform !== 'win32') throw new Error('pack-win 只能在 Windows 上运行');
  const supervisorOut = join(OUT_ROOT, '.publish-supervisor');
  const wpfOut = join(OUT_ROOT, '.publish-wpf');

  await rm(APP, { recursive: true, force: true });
  await mkdir(join(APP, 'runtime'), { recursive: true });
  await mkdir(join(APP, 'packages', 'session-service', 'dist'), { recursive: true });
  await mkdir(join(APP, 'packages', 'web-console'), { recursive: true });
  await mkdir(join(APP, 'games'), { recursive: true });

  await publish('apps/BattlePlatform.Supervisor/BattlePlatform.Supervisor.csproj', supervisorOut);
  await publish('apps/BattlePlatform.Wpf/BattlePlatform.Wpf.csproj', wpfOut);
  await copyExe(supervisorOut, 'bp-supervisor.exe', APP);
  await copyExe(wpfOut, '3178.exe', APP);

  await copyFile(process.execPath, join(APP, 'runtime', 'node.exe'));

  await esbuild({
    entryPoints: [join(REPO, 'packages', 'session-service', 'dist', 'main.js')],
    outfile: join(APP, 'packages', 'session-service', 'dist', 'main.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    sourcemap: false,
    legalComments: 'none',
    external: ['bufferutil', 'utf-8-validate'],
    logLevel: 'silent',
  });
  await esbuild({
    entryPoints: [join(REPO, 'packages', 'session-service', 'dist', 'authority-runner.js')],
    outfile: join(APP, 'packages', 'session-service', 'dist', 'authority-runner.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'silent',
  });
  await cp(join(REPO, 'packages', 'web-console', 'public'), join(APP, 'packages', 'web-console', 'public'), {
    recursive: true,
  });

  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout?.trim() ?? 'unknown';
  const files = [];
  for (const relative of [
    '3178.exe',
    'bp-supervisor.exe',
    'runtime/node.exe',
    'packages/session-service/dist/main.cjs',
    'packages/session-service/dist/authority-runner.cjs',
  ]) {
    const absolute = join(APP, ...relative.split('/'));
    files.push({ path: relative, bytes: (await stat(absolute)).size, sha256: await sha256(absolute) });
  }
  await writeFile(join(APP, 'build-manifest.json'), `${JSON.stringify({
    product: '3178',
    version: JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8')).version,
    commit,
    node: process.version,
    dotnet: dotnet,
    rid: 'win-x64',
    files,
  }, null, 2)}\n`);

  await rm(supervisorOut, { recursive: true, force: true });
  await rm(wpfOut, { recursive: true, force: true });
  console.log(`BP_PACK_DIR=${APP}`);
}

main().catch((error) => {
  console.error(`pack-win: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
