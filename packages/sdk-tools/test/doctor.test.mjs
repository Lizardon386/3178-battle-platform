import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

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

const REFERENCE = {
  version: 1,
  title: '变色对决规则',
  groups: [
    {
      id: 'basic',
      title: '基本规则',
      items: [{ title: '出牌', text: '打出一张与桌面颜色或数字相同的牌。', images: [{ path: 'images/play.png', alt: '出牌示意' }] }],
    },
  ],
};

function sourceDir({ reference = REFERENCE, writeReference = true, manifestExtra = {} } = {}) {
  const dir = tempDir('sdk-doctor-');
  writeFileSync(
    join(dir, 'bpmap.json'),
    JSON.stringify({
      id: 'duelsample',
      version: '0.1.0',
      server: 'server.js',
      client: 'client.js',
      reference: { entry: 'reference.json' },
      ...manifestExtra,
    }),
    'utf8',
  );
  writeFileSync(join(dir, 'server.js'), 'export const ok = true;\n', 'utf8');
  writeFileSync(join(dir, 'client.js'), 'export default {};\n', 'utf8');
  if (writeReference) {
    writeFileSync(join(dir, 'reference.json'), JSON.stringify(reference), 'utf8');
  }
  return dir;
}

function run(args) {
  return spawnSync(process.execPath, [TOOL, ...args], { cwd: ROOT, encoding: 'utf8' });
}

test('doctor：源目录检查资料文档入口、文件与格式', () => {
  const source = sourceDir();
  const result = run(['doctor', source]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[ok\] 资料文档入口 reference\.json/);
  assert.match(result.stdout, /\[ok\] 资料文档 reference\.json/);
  assert.match(result.stdout, /\[ok\] 资料文档格式/);
});

test('doctor：资料文档缺失时报 [x] 并退出 1', () => {
  const source = sourceDir({ writeReference: false });
  const result = run(['doctor', source]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[x\] 资料文档 reference\.json/);
  assert.match(result.stderr, /doctor 发现/);
});

test('doctor：资料文档格式不对时报 [x] 并带原因', () => {
  const source = sourceDir({ reference: { version: 1, groups: [] } });
  const result = run(['doctor', source]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[x\] 资料文档格式（groups 至少要有一个分组）/);
});

test('doctor：没有声明 reference 时不加检查项', () => {
  const source = sourceDir();
  writeFileSync(
    join(source, 'bpmap.json'),
    JSON.stringify({ id: 'duelsample', version: '0.1.0', server: 'server.js', client: 'client.js' }),
    'utf8',
  );
  const result = run(['doctor', source]);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /资料文档/);
});

test('doctor：单文件包按包头 reference 检查清单与格式', () => {
  const source = sourceDir();
  const out = join(tempDir('sdk-doctor-pack-'), 'duelsample.bpmap');
  const packed = run(['pack', source, '--out', out]);
  assert.equal(packed.status, 0, packed.stderr);

  const result = run(['doctor', out]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[ok\] 资料文档 reference\.json 在包清单里/);
  assert.match(result.stdout, /\[ok\] 资料文档格式/);
});

test('pack：声明了 reference 但文件不存在时拒绝打包', () => {
  const source = sourceDir({ writeReference: false });
  const out = join(tempDir('sdk-doctor-badpack-'), 'duelsample.bpmap');
  const result = run(['pack', source, '--out', out]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /资料文档不存在：reference\.json/);
});
