#!/usr/bin/env node
/**
 * 用法：node setup-sdk.mjs [--release sdk-v0.1.0] [--tarballs <Release 目录>] [--platform <3178 仓库>] [--sdk-dir sdk]
 * 三种来源按顺序选一个：
 *   --release   从 GitHub Release 下载四个 tarball、验 SHA256，再安装（外部接入一条命令）
 *   --tarballs  直接安装 Release 下载目录里的四个 tarball
 *   --platform  从平台仓库打四个 tarball 再安装（开发时用）
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} 后面要跟一个值`);
  return value;
};

const gameRoot = process.cwd();
const releaseDir = argValue('--tarballs', null);
const releaseTag = argValue('--release', null);
const releaseBase = argValue('--release-base', 'https://github.com/Lizardon386/3178-battle-platform/releases/download');
const platformRoot = resolve(argValue('--platform', '../3178-battle-platform'));
const sdkDir = resolve(argValue('--sdk-dir', 'sdk'));
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const PACKAGE_PREFIXES = ['3178-core-abi-', '3178-pack-format-', '3178-game-sdk-', '3178-sdk-tools-'];

function fail(message) {
  console.error(`[x] ${message}`);
  process.exit(1);
}

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit' });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function npm(commandArgs, cwd) {
  if (existsSync(npmCli)) {
    run(process.execPath, [npmCli, ...commandArgs], cwd);
    return;
  }
  const result = spawnSync('npm', commandArgs, { cwd, stdio: 'inherit', shell: true });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!releaseDir && !releaseTag && !existsSync(join(platformRoot, 'packages', 'game-sdk', 'package.json'))) {
  fail(`找不到平台仓库：${platformRoot}，用 --platform 指向 3178-battle-platform；或用 --release sdk-v0.1.0 / --tarballs`);
}

const packagePath = join(gameRoot, 'package.json');
if (!existsSync(packagePath)) {
  writeFileSync(packagePath, JSON.stringify({
    name: basename(gameRoot).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'mygame',
    version: '0.1.0',
    private: true,
    type: 'module',
  }, null, 2) + '\n');
  console.log('没有 package.json，已生成一个最小版本');
} else {
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  if (pkg.type !== 'module') {
    pkg.type = 'module';
    writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
    console.log('package.json 已补上 "type": "module"');
  }
}

if (!releaseDir && !releaseTag &&
    (!existsSync(join(platformRoot, 'packages', 'game-sdk', 'dist', 'index.js')) ||
     !existsSync(join(platformRoot, 'packages', 'core-abi', 'dist', 'index.js')) ||
     !existsSync(join(platformRoot, 'packages', 'pack-format', 'dist', 'index.js')) ||
     !existsSync(join(platformRoot, 'packages', 'sdk-tools', 'dist', 'cli', 'index.js')))) {
  console.log('平台还没构建，先跑 npm run build');
  npm(['run', 'build'], platformRoot);
}

let tarballs;
if (releaseTag) {
  mkdirSync(sdkDir, { recursive: true });
  for (const name of readdirSync(sdkDir)) {
    if (name.endsWith('.tgz')) rmSync(join(sdkDir, name));
  }
  const base = `${releaseBase.replace(/\/+$/, '')}/${releaseTag}`;
  const sumsResponse = await fetch(`${base}/SHA256SUMS`, { signal: AbortSignal.timeout(15_000) });
  if (!sumsResponse.ok) fail(`下载 SHA256SUMS 失败：${sumsResponse.status}`);
  const sums = (await sumsResponse.text())
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [hash, name] = line.split(/\s+/);
      return { hash, name };
    })
    .filter(({ name }) => name && PACKAGE_PREFIXES.some((prefix) => name.startsWith(prefix)) && name.endsWith('.tgz'));
  for (const prefix of PACKAGE_PREFIXES) {
    if (!sums.some(({ name }) => name.startsWith(prefix))) fail(`Release ${releaseTag} 缺少 ${prefix}*.tgz`);
  }
  for (const { hash, name } of sums) {
    const response = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) fail(`下载 ${name} 失败：${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== hash) fail(`SHA256 不匹配：${name}（${actual} != ${hash}）`);
    writeFileSync(join(sdkDir, name), bytes);
    console.log(`已下载 ${name}`);
  }
  tarballs = sums.map(({ name }) => join(sdkDir, name));
} else if (releaseDir) {
  const dir = resolve(releaseDir);
  if (!existsSync(dir)) fail(`Release 目录不存在：${dir}`);
  const found = readdirSync(dir).filter((name) => name.endsWith('.tgz'));
  for (const prefix of PACKAGE_PREFIXES) {
    if (!found.some((name) => name.startsWith(prefix))) fail(`Release 目录缺少 ${prefix}*.tgz：${dir}`);
  }
  tarballs = found.map((name) => join(dir, name));
} else {
  mkdirSync(sdkDir, { recursive: true });
  for (const name of readdirSync(sdkDir)) {
    if (name.endsWith('.tgz')) rmSync(join(sdkDir, name));
  }

  npm(['pack', './packages/core-abi', '--pack-destination', sdkDir], platformRoot);
  npm(['pack', './packages/pack-format', '--pack-destination', sdkDir], platformRoot);
  npm(['pack', './packages/game-sdk', '--pack-destination', sdkDir], platformRoot);
  npm(['pack', './packages/sdk-tools', '--pack-destination', sdkDir], platformRoot);

  tarballs = readdirSync(sdkDir)
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => join(sdkDir, name));
}

npm(['install', '--save-dev', ...tarballs, 'esbuild'], gameRoot);

console.log('');
console.log(`SDK 已安装到 ${gameRoot}`);
console.log(`  ${tarballs.map((file) => basename(file)).join('、')}`);
console.log('下一步：node scripts/build.mjs');
