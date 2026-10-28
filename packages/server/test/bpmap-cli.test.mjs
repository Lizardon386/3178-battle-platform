import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readPack } from '@bp/server';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const TOOL = join(ROOT, 'tools', 'packaging', 'bpmap.mjs');

const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function sourceDir() {
  const dir = tempDir('bp-cli-src-');
  writeFileSync(
    join(dir, 'bpmap.json'),
    JSON.stringify({ id: 'clisample', version: '0.1.0', server: 'server.js', client: 'client.js' }),
    'utf8',
  );
  writeFileSync(join(dir, 'server.js'), 'export const ok = true;\n', 'utf8');
  writeFileSync(join(dir, 'client.js'), 'export default {};\n', 'utf8');
  return dir;
}

function run(args) {
  return spawnSync(process.execPath, [TOOL, ...args], { cwd: ROOT, encoding: 'utf8' });
}

test('bpmap CLI：pack / inspect / unpack 往返', () => {
  const source = sourceDir();
  const out = join(tempDir('bp-cli-out-'), 'clisample.bpmap');

  const packed = run(['pack', source, '--out', out]);
  assert.equal(packed.status, 0, packed.stderr);
  assert.match(packed.stdout, /已生成/);
  assert.match(packed.stdout, /clisample 0\.1\.0/);
  assert.match(packed.stdout, /包哈希/);
  const pack = readPack(out);
  assert.equal(pack.manifest.id, 'clisample');
  assert.deepEqual(pack.manifest.files.map((entry) => entry.path), ['client.js', 'server.js']);

  const inspected = run(['inspect', out]);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.match(inspected.stdout, /clisample/);
  assert.match(inspected.stdout, /server\.js/);

  const target = tempDir('bp-cli-unpack-');
  const unpacked = run(['unpack', out, target]);
  assert.equal(unpacked.status, 0, unpacked.stderr);
  assert.equal(readFileSync(join(target, 'server.js'), 'utf8'), 'export const ok = true;\n');
  assert.equal(readFileSync(join(target, 'client.js'), 'utf8'), 'export default {};\n');
});

test('bpmap doctor：源目录和单文件包都能检查入口', () => {
  const source = sourceDir();
  const sourceResult = run(['doctor', source]);
  assert.equal(sourceResult.status, 0, sourceResult.stderr);
  assert.match(sourceResult.stdout, /clisample 0\.1\.0/);
  assert.match(sourceResult.stdout, /\[ok\] 服务端入口/);
  assert.match(sourceResult.stdout, /\[ok\] 客户端入口/);

  const out = join(tempDir('bp-cli-doctor-'), 'clisample.bpmap');
  const packed = run(['pack', source, '--out', out]);
  assert.equal(packed.status, 0, packed.stderr);
  const packResult = run(['doctor', out]);
  assert.equal(packResult.status, 0, packResult.stderr);
  assert.match(packResult.stdout, /类型：单文件包/);
  assert.match(packResult.stdout, /\[ok\] 包格式 1/);
});

test('bpmap doctor：显示源清单的 mode/apiVersion', () => {
  const source = tempDir('bp-cli-mode-');
  writeFileSync(
    join(source, 'bpmap.json'),
    JSON.stringify({ id: 'clisample', version: '0.1.0', mode: 'realtime', apiVersion: 2, server: 'server.js' }),
    'utf8',
  );
  writeFileSync(join(source, 'server.js'), 'export const ok = true;\n', 'utf8');
  const result = run(['doctor', source]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /realtime \/ 2/);
});

test('bpmap doctor：入口缺失时退出码非 0', () => {
  const source = tempDir('bp-cli-bad-doctor-');
  writeFileSync(
    join(source, 'bpmap.json'),
    JSON.stringify({ id: 'clisample', version: '0.1.0', server: 'missing.js' }),
    'utf8',
  );
  const result = run(['doctor', source]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /doctor 发现/);
});

test('bpmap CLI：输出放在源目录里会被拒绝', () => {
  const source = sourceDir();
  const result = run(['pack', source, '--out', join(source, 'x.bpmap')]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /输出不能放在源目录里/);
});
