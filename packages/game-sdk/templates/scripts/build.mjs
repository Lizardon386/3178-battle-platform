#!/usr/bin/env node
/**
 * 用法：node scripts/build.mjs [--platform <3178 仓库>] [--start] [--host <地址>]
 *        [--port 3178] [--lan-port 3000] [--out dist/<id>.bpmap]
 * 构建 server 和客户端、生成 dist-pack/bpmap.json、打包并校验；
 * --platform 复制到平台的 games/，--start 启动宿主，--host 调 bpmap doctor。
 */
import { createRequire } from 'node:module';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { API_VERSION, DEFAULT_MODE } from '@bp/core-abi';
import { packDirectory, readPack, readPackSource } from '@bp/game-sdk/node';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} 后面要跟一个值`);
  return value;
};
const hasFlag = (name) => args.includes(name);

const gameRoot = process.cwd();
const packagePath = join(gameRoot, 'package.json');
if (!existsSync(packagePath)) fail('没有 package.json，先跑 node scripts/setup-sdk.mjs');

const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
const id = pkg.bp?.id ?? pkg.name;
const version = pkg.version;
const entry = pkg.bp?.entry ?? 'client/client.js';
const outDir = join(gameRoot, 'dist-pack');
const packFile = resolve(gameRoot, argValue('--out', `dist/${id}.bpmap`));
const platformRoot = argValue('--platform', null);
const hostUrl = argValue('--host', null);
const shouldStart = hasFlag('--start');

if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(String(id))) {
  fail(`package.json 的 bp.id 不合法：${id}（只允许小写字母、数字、连字符）`);
}
if (typeof version !== 'string' || !/^\S{1,64}$/.test(version)) {
  fail(`package.json 的 version 不合法：${version}`);
}
if (typeof entry !== 'string' || entry.includes('..') || isAbsolute(entry) || entry.includes('\\')) {
  fail(`package.json 的 bp.entry 必须是包内相对路径：${entry}`);
}
if (packFile === outDir || packFile.startsWith(`${outDir}${sep}`)) {
  fail('--out 不能放在 dist-pack 里，否则下次打包会把旧包也装进去');
}
if (shouldStart && !platformRoot) fail('--start 需要同时给 --platform <3178 仓库>');

const hasClient = existsSync(join(gameRoot, 'src', 'client.ts'));
if (!hasClient && entry !== 'client/client.js') {
  log(`没有 src/client.ts，忽略 bp.entry=${entry}，按无客户端游戏打包`);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(gameRoot, 'src', 'server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['@bp/game-sdk', '@bp/game-sdk/node', '@bp/core-abi'],
  outfile: join(outDir, 'server.js'),
  logLevel: 'info',
});

if (hasClient) {
  const clientOut = join(outDir, entry);
  await build({
    entryPoints: [join(gameRoot, 'src', 'client.ts')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outfile: clientOut,
    logLevel: 'info',
  });
  if (existsSync(join(gameRoot, 'src', 'assets'))) {
    cpSync(join(gameRoot, 'src', 'assets'), join(dirname(clientOut), 'assets'), { recursive: true });
  }
}

const manifest = {
  id,
  version,
  mode: pkg.bp?.mode ?? DEFAULT_MODE,
  apiVersion: pkg.bp?.apiVersion ?? API_VERSION,
  server: 'server.js',
  ...(hasClient ? { client: entry } : {}),
};
writeFileSync(join(outDir, 'bpmap.json'), JSON.stringify(manifest, null, 2) + '\n');

const source = readPackSource(outDir);
const packed = packDirectory(outDir, packFile, source);
const pack = readPack(packFile);
const bytes = packed.files.reduce((sum, file) => sum + file.size, 0);

console.log('');
console.log(`已生成 ${packFile}`);
console.log(`  id/version：${packed.id} ${packed.version}`);
console.log(`  文件：${packed.files.length} 个，${bytes} 字节`);
console.log(`  包哈希：${pack.packageHash}`);

if (platformRoot) {
  const platform = resolve(gameRoot, platformRoot);
  const gamesDir = join(platform, 'games');
  if (!existsSync(gamesDir)) fail(`平台里没有 games 目录：${gamesDir}`);
  const target = join(gamesDir, `${id}.bpmap`);
  copyFileSync(packFile, target);
  console.log(`已安装到 ${target}`);
}

if (hostUrl) {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('@bp/game-sdk/package.json')), 'dist', 'cli', 'index.js');
  console.log(`检查宿主兼容性：${hostUrl}`);
  const result = spawnSync(process.execPath, [cli, 'doctor', packFile, '--host', hostUrl], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (shouldStart) {
  const platform = resolve(gameRoot, platformRoot);
  const hostCli = join(platform, 'packages', 'hostd', 'dist', 'cli.js');
  if (!existsSync(hostCli)) fail('平台还没构建：先在平台仓库跑 npm run build');
  const port = argValue('--port', '3178');
  const lanPort = argValue('--lan-port', '3000');
  console.log(`启动宿主：http://127.0.0.1:${port}`);
  const result = spawnSync(process.execPath, [hostCli, 'host', '--port', port, '--lan-port', lanPort], {
    cwd: platform,
    stdio: 'inherit',
  });
  process.exit(result.status ?? 0);
}

console.log('下一步：重启宿主，建房时就能在列表里看到它。');

function fail(message) {
  console.error(`[x] ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[i] ${message}`);
}
