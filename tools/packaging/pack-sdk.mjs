#!/usr/bin/env node
/**
 * 生成 SDK 0.x 的 GitHub Release 资产：四个 tarball、SHA256SUMS、Release 说明。
 * 用法：node tools/packaging/pack-sdk.mjs
 * 产物在 dist-sdk/（不入库）；脚本会先检查包元数据，避免把 private 包或 `*` 依赖发出去。
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'dist-sdk');
const NPM_CLI = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const PACKAGES = [
  { dir: 'core-abi', prefix: 'lizardon386-core-abi-' },
  { dir: 'pack-format', prefix: 'lizardon386-pack-format-' },
  { dir: 'game-sdk', prefix: 'lizardon386-game-sdk-' },
  { dir: 'sdk-tools', prefix: 'lizardon386-sdk-tools-' },
];
const INTERNAL_DEPS = {
  'core-abi': [],
  'pack-format': ['@lizardon386/core-abi'],
  'game-sdk': ['@lizardon386/core-abi', '@lizardon386/pack-format'],
  'sdk-tools': ['@lizardon386/core-abi', '@lizardon386/pack-format'],
};

function fail(message) {
  console.error(`[x] ${message}`);
  process.exit(1);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const manifests = PACKAGES.map(({ dir }) => ({
  dir,
  pkg: JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8')),
}));
const versions = new Set(manifests.map(({ pkg }) => pkg.version));
if (versions.size !== 1) fail(`四个包版本不一致：${[...versions].join(' / ')}`);
const version = manifests[0].pkg.version;
for (const { dir, pkg } of manifests) {
  if (pkg.private === true) fail(`${pkg.name} 仍是 private`);
  if (pkg.license !== 'MIT') fail(`${pkg.name} 缺少 license`);
  for (const dep of INTERNAL_DEPS[dir]) {
    if (pkg.dependencies?.[dep] !== `^${version}`) {
      fail(`${pkg.name} 对 ${dep} 的依赖不是 ^${version}`);
    }
  }
  if (!String(pkg.repository?.directory ?? '').endsWith(`packages/${dir}`)) {
    fail(`${pkg.name} 的 repository.directory 不对`);
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const { dir } of PACKAGES) {
  const args = ['pack', `./packages/${dir}`, '--pack-destination', OUT];
  const result = existsSync(NPM_CLI)
    ? spawnSync(process.execPath, [NPM_CLI, ...args], { cwd: ROOT, stdio: 'inherit' })
    : spawnSync('npm', args, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (result.status !== 0) fail(`npm pack packages/${dir} 失败`);
}

const tgz = readdirSync(OUT).filter((name) => name.endsWith('.tgz')).sort();
for (const { prefix } of PACKAGES) {
  if (!tgz.some((name) => name.startsWith(prefix))) fail(`缺少 ${prefix}*.tgz`);
}
copyFileSync(join(ROOT, 'packages', 'sdk-tools', 'templates', 'scripts', 'setup-sdk.mjs'), join(OUT, 'setup-sdk.mjs'));
const assets = [...tgz, 'setup-sdk.mjs'];
const sums = assets.map((name) => `${sha256(readFileSync(join(OUT, name)))}  ${name}`);
writeFileSync(join(OUT, 'SHA256SUMS'), `${sums.join('\n')}\n`, 'utf8');

const install = `npm install --save-dev \\
  ./lizardon386-core-abi-${version}.tgz \\
  ./lizardon386-pack-format-${version}.tgz \\
  ./lizardon386-game-sdk-${version}.tgz \\
  ./lizardon386-sdk-tools-${version}.tgz \\
  esbuild`;
const notes = `# 3178 SDK ${version}

回合制接入预览版。四个 tarball 要一起安装；当前没有发布到 npm，也没有 realtime 运行时。

## 安装（npm，推荐）

\`\`\`bash
npm install @lizardon386/game-sdk
npm install --save-dev @lizardon386/sdk-tools esbuild
\`\`\`

## 离线安装

一条命令下载并安装四个 tarball（会校验 SHA256）：

\`\`\`bash
node setup-sdk.mjs --release sdk-v${version}
\`\`\`

也可以先下载四个 \`.tgz\` 到游戏工程目录，再执行：

\`\`\`bash
${install}
\`\`\`

需要 Node.js >= 20.19。构建/打包还需要 \`esbuild\`。

## 范围

- \`turn\` 模式、\`apiVersion 1\` 可用
- \`@lizardon386/game-sdk\` 是游戏唯一需要直接依赖的运行时包
- \`@lizardon386/sdk-tools\` 提供 \`bpmap\` CLI、\`doctor\` 和工程模板
- 不包含 realtime 运行时；规划中的实时能力不在本版本内

## 校验

\`\`\`bash
sha256sum -c SHA256SUMS
\`\`\`

接入文档：https://github.com/Lizardon386/3178-battle-platform/blob/master/INTEGRATION_GUIDE.md
`;
writeFileSync(join(OUT, 'RELEASE_NOTES.md'), notes, 'utf8');

console.log(`\nSDK ${version} 资产已生成：${OUT}`);
for (const name of assets) console.log(`  ${name}`);
console.log('  SHA256SUMS');
console.log('  RELEASE_NOTES.md');
