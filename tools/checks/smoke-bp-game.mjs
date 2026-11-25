#!/usr/bin/env node
/**
 * 外部消费者 smoke：把 @bp/game-package 与 @lizardon386/bp-game 打成 tarball，
 * 在仓库外临时工程安装（不使用 workspace link），再构建一个真实 .bpkg。
 * 需要 npm 网络（esbuild 依赖）；CI 上跑，作为发布前的最低外部验证。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPackage } from '@bp/game-package';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = mkdtempSync(join(tmpdir(), 'bp-external-smoke-'));
const tarballs = join(tempRoot, 'tarballs');
const project = join(tempRoot, 'project');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, cwd, label) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    // Windows 上 npm 是 .cmd，必须经 shell；node 路径带空格，不能走 shell。
    shell: process.platform === 'win32' && command === npm,
  });
  if (result.status !== 0) throw new Error(`${label}失败（exit=${result.status ?? 'null'}）`);
}

try {
  mkdirSync(tarballs, { recursive: true });
  run(npm, ['pack', './packages/game-package', './packages/bp-game', '--pack-destination', tarballs], REPO, 'npm pack');

  const packed = readdirSync(tarballs);
  const gamePackageTar = packed.find((name) => name.startsWith('bp-game-package-'));
  const bpGameTar = packed.find((name) => name.startsWith('lizardon386-bp-game-'));
  if (!gamePackageTar || !bpGameTar) throw new Error(`没找到 tarball：${packed.join(', ')}`);

  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'package.json'), `${JSON.stringify({
    name: 'external-smoke',
    private: true,
    type: 'module',
    dependencies: {
      '@bp/game-package': `file:../tarballs/${gamePackageTar}`,
      '@lizardon386/bp-game': `file:../tarballs/${bpGameTar}`,
    },
  }, null, 2)}\n`);

  run(npm, ['install', '--no-audit', '--no-fund', '--prefer-offline'], project, 'npm install');

  const installed = join(project, 'node_modules', '@lizardon386', 'bp-game');
  if (lstatSync(installed).isSymbolicLink()) throw new Error('外部工程装成了 workspace link，不是真实 tarball');
  if (!existsSync(join(project, 'node_modules', '@bp', 'game-package', 'dist', 'index.js'))) {
    throw new Error('外部工程没有装上 @bp/game-package');
  }

  mkdirSync(join(project, 'src', 'authority'), { recursive: true });
  mkdirSync(join(project, 'src', 'web'), { recursive: true });
  writeFileSync(join(project, 'game.manifest.json'), `${JSON.stringify({
    id: 'external-game',
    name: '外部游戏',
    version: '1.0.0',
    platformRequirements: { protocolVersion: 1, minPlayers: 2, maxPlayers: 2 },
    entryPoints: { authority: 'authority/index.js', web: 'web/index.html' },
    sessionConfig: { fields: [] },
    reference: { entry: 'reference.json' },
  }, null, 2)}\n`);
  writeFileSync(join(project, 'src', 'authority', 'process.js'), 'console.log("EXTERNAL_BUNDLE_MARKER");\n');
  writeFileSync(join(project, 'src', 'web', 'index.html'), '<!doctype html><title>external</title>\n');
  writeFileSync(join(project, 'src', 'reference.json'), '{"name":"external"}\n');

  const cli = join(installed, 'dist', 'cli.js');
  run(process.execPath, [cli, 'build', '.', '--authority', 'src/authority/process.js', '--out', 'out/external.bpkg'], project, 'bp-game build');
  run(process.execPath, [cli, 'inspect', 'out/external.bpkg'], project, 'bp-game inspect');

  const pack = readPackage(join(project, 'out', 'external.bpkg'));
  const authority = pack.files.find((file) => file.path === 'authority/index.js');
  if (!authority || !authority.bytes.toString('utf8').includes('EXTERNAL_BUNDLE_MARKER')) {
    throw new Error('外部构建的 Authority bundle 不包含标记');
  }
  console.log(`external smoke OK: ${pack.manifest.id}@${pack.manifest.version} ${pack.packageHash.slice(0, 12)}…`);
} finally {
  if (!process.env.BP_KEEP_SMOKE) rmSync(tempRoot, { recursive: true, force: true });
}
