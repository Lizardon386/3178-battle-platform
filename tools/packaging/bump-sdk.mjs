#!/usr/bin/env node
/**
 * 用法：npm run bump:sdk -- 0.2.1 [--dry-run]
 * 同步改四个 SDK 包的 version 和内部依赖，再更新 package-lock。
 * 不发布、不打 tag；发布由 sdk-v* tag + publish-sdk.yml 完成。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIRS = ['core-abi', 'pack-format', 'game-sdk', 'sdk-tools'];
const INTERNAL = ['@lizardon386/core-abi', '@lizardon386/pack-format'];
const NPM_CLI = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const version = args.find((arg) => !arg.startsWith('--'));

function fail(message) {
  console.error(`[x] ${message}`);
  process.exit(1);
}

if (!version) fail('用法：npm run bump:sdk -- <版本> [--dry-run]');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`版本不合法：${version}（示例 0.2.1 / 0.3.0-beta.1）`);
}

const changes = [];
for (const dir of DIRS) {
  const path = join(ROOT, 'packages', dir, 'package.json');
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  const before = pkg.version;
  pkg.version = version;
  const bumpedDeps = [];
  for (const dep of INTERNAL) {
    if (pkg.dependencies?.[dep] && pkg.dependencies[dep] !== `^${version}`) {
      pkg.dependencies[dep] = `^${version}`;
      bumpedDeps.push(dep);
    }
  }
  changes.push({ name: pkg.name, before, after: version, deps: bumpedDeps });
  if (!dryRun) writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

console.log(`SDK 版本 → ${version}${dryRun ? '（dry-run，不写文件）' : ''}`);
for (const item of changes) {
  const deps = item.deps.length ? `；依赖 ${item.deps.join('、')} 同步改 ^${version}` : '';
  console.log(`  ${item.name}: ${item.before} → ${item.after}${deps}`);
}

if (!dryRun) {
  const result = existsSync(NPM_CLI)
    ? spawnSync(process.execPath, [NPM_CLI, 'install', '--package-lock-only', '--ignore-scripts'], { cwd: ROOT, stdio: 'inherit' })
    : spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], { cwd: ROOT, stdio: 'inherit', shell: true });
  if (result.status !== 0) fail('更新 package-lock 失败');
}

console.log('');
console.log('下一步：');
console.log('  npm test');
console.log('  npm run seam');
console.log('  node tools/checks/smoke-sdk.mjs');
console.log(`  git add -A && git commit -m "chore: SDK ${version}"`);
console.log(`  git tag sdk-v${version} && git push origin master sdk-v${version}`);
