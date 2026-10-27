#!/usr/bin/env node
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { readPack } from '@bp/game-sdk/node';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const testTools = join(root, 'tools', 'testkit');
const gamesDir = join(root, 'games');
const bpmapCli = join(root, 'packages', 'sdk-tools', 'dist', 'cli', 'index.js');
const specs = [
  { dir: 'turn-based', file: 'fixture-turn.bpmap' },
  { dir: 'simultaneous', file: 'fixture-simultaneous.bpmap' },
  { dir: 'kit-client', file: 'fixture-kit.bpmap', client: 'client.ts', assets: 'assets' },
];

mkdirSync(gamesDir, { recursive: true });
for (const spec of specs) {
  const distDir = join(testTools, 'dist', 'test-games', spec.dir);
  const entry = join(distDir, 'index.js');
  const loaded = await import(pathToFileURL(entry).href);
  const module = loaded.default;
  if (!module || typeof module.id !== 'string' || typeof module.version !== 'string') {
    throw new Error(`测试夹具没有导出合法的 GameModule：${entry}`);
  }
  const staging = mkdtempSync(join(tmpdir(), 'bp-test-game-'));
  try {
    cpSync(entry, join(staging, 'index.js'));
    if (spec.client) {
      await build({
        entryPoints: [join(testTools, 'src', 'test-games', spec.dir, spec.client)],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile: join(staging, 'client.js'),
        logLevel: 'silent',
      });
    }
    if (spec.assets) {
      cpSync(join(testTools, 'src', 'test-games', spec.dir, spec.assets), join(staging, spec.assets), { recursive: true });
    }
    writeFileSync(
      join(staging, 'bpmap.json'),
      JSON.stringify({
        id: module.id,
        version: module.version,
        mode: 'turn',
        apiVersion: 1,
        server: 'index.js',
        ...(spec.client ? { client: 'client.js' } : {}),
      }),
      'utf8',
    );
    const out = join(gamesDir, spec.file);
    const packed = spawnSync(process.execPath, [bpmapCli, 'pack', staging, '--out', out], {
      cwd: root,
      encoding: 'utf8',
    });
    if (packed.status !== 0) {
      throw new Error(`bpmap pack 失败：${packed.stderr || packed.stdout}`);
    }
    const pack = readPack(out);
    console.log(`已生成 ${out}（${pack.manifest.id} ${pack.manifest.version}，${pack.manifest.files.length} 个文件）`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
