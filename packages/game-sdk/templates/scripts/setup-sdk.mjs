#!/usr/bin/env node
/**
 * 用法：node scripts/setup-sdk.mjs [--platform <3178 仓库>] [--sdk-dir sdk]
 * 把 core-abi 和 game-sdk 打成 tarball，安装到当前游戏工程，并补上 package.json 的 type=module。
 */
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
const platformRoot = resolve(argValue('--platform', '../3178-battle-platform'));
const sdkDir = resolve(argValue('--sdk-dir', 'sdk'));
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

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

if (!existsSync(join(platformRoot, 'packages', 'game-sdk', 'package.json'))) {
  fail(`找不到平台仓库：${platformRoot}，用 --platform 指向 3178-battle-platform`);
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

if (!existsSync(join(platformRoot, 'packages', 'game-sdk', 'dist', 'index.js')) ||
    !existsSync(join(platformRoot, 'packages', 'core-abi', 'dist', 'index.js'))) {
  console.log('平台还没构建，先跑 npm run build');
  npm(['run', 'build'], platformRoot);
}

mkdirSync(sdkDir, { recursive: true });
for (const name of readdirSync(sdkDir)) {
  if (name.endsWith('.tgz')) rmSync(join(sdkDir, name));
}

npm(['pack', './packages/core-abi', '--pack-destination', sdkDir], platformRoot);
npm(['pack', './packages/game-sdk', '--pack-destination', sdkDir], platformRoot);

const tarballs = readdirSync(sdkDir)
  .filter((name) => name.endsWith('.tgz'))
  .map((name) => join(sdkDir, name));
npm(['install', '--save-dev', ...tarballs, 'esbuild'], gameRoot);

console.log('');
console.log(`SDK 已安装到 ${gameRoot}`);
console.log(`  ${tarballs.map((file) => basename(file)).join('、')}`);
console.log('下一步：node scripts/build.mjs');
