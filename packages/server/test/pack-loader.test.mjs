import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadGameSet, packDirectory, readPackSource } from '@bp/server';

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function moduleSourceDir(id, version) {
  const dir = tempDir('bp-module-');
  writeFileSync(
    join(dir, 'bpmap.json'),
    JSON.stringify({ id, version, server: 'server.js', client: 'client.js' }),
    'utf8',
  );
  writeFileSync(
    join(dir, 'server.js'),
    `const instance = {
  serialize: () => ({ kind: 'sample' }),
  handle: () => [],
  begin: () => [],
  snapshot: () => ({ version: 1 }),
};
export default {
  id: ${JSON.stringify(id)},
  name: '样本',
  version: ${JSON.stringify(version)},
  entry: 'client.js',
  seats: { min: 1, max: 2 },
  allowSpectate: false,
  soloFill: false,
  roles: ['host', 'player'],
  normalizeConfig: () => ({}),
  rulesHashOf: () => 'rules',
  create: () => instance,
  resume: () => instance,
};
`,
    'utf8',
  );
  writeFileSync(join(dir, 'client.js'), 'export default { mount() {} };\n', 'utf8');
  return dir;
}

test('单文件包：loadGameSet 解包并加载服务端模块', async () => {
  const gamesRoot = tempDir('bp-games-');
  const source = moduleSourceDir('sample', '0.1.0');
  packDirectory(source, join(gamesRoot, 'sample.bpmap'), readPackSource(source));

  const set = await loadGameSet(gamesRoot, tempDir('bp-cache-'));
  assert.equal(set.errors.length, 0);
  assert.equal(set.modules.length, 1);
  assert.equal(set.modules[0].id, 'sample');
  assert.match(set.modules[0].version, /^0\.1\.0\+[0-9a-f]{12}$/);

  const root = set.roots.get('sample');
  assert.ok(root);
  assert.ok(existsSync(join(root, 'server.js')));
  assert.ok(existsSync(join(root, 'client.js')));
});

test('单文件包：坏包跳过，不挡其他游戏', async () => {
  const gamesRoot = tempDir('bp-games-');
  const source = moduleSourceDir('sample', '0.1.0');
  packDirectory(source, join(gamesRoot, 'good.bpmap'), readPackSource(source));
  writeFileSync(join(gamesRoot, 'bad.bpmap'), 'not a pack', 'utf8');

  const set = await loadGameSet(gamesRoot, tempDir('bp-cache-'));
  assert.equal(set.modules.length, 1);
  assert.equal(set.errors.length, 1);
  assert.match(set.errors[0].source, /bad\.bpmap$/);
  assert.match(set.errors[0].message, /文件太短/);
});

test('单文件包：同 id 的包不覆盖已加载游戏', async () => {
  const gamesRoot = tempDir('bp-games-');
  const first = moduleSourceDir('sample', '0.1.0');
  const second = moduleSourceDir('sample', '0.2.0');
  packDirectory(first, join(gamesRoot, 'a.bpmap'), readPackSource(first));
  packDirectory(second, join(gamesRoot, 'b.bpmap'), readPackSource(second));

  const set = await loadGameSet(gamesRoot, tempDir('bp-cache-'));
  assert.equal(set.modules.length, 1);
  assert.equal(set.errors.length, 1);
  assert.match(set.errors[0].message, /重复/);
  assert.equal(set.modules[0].version.startsWith('0.1.0+'), true);
});

test('单文件包：包清单版本与模块不符时跳过', async () => {
  const gamesRoot = tempDir('bp-games-');
  const source = moduleSourceDir('sample', '0.1.0');
  packDirectory(source, join(gamesRoot, 'mismatch.bpmap'), { ...readPackSource(source), version: '0.2.0' });

  const set = await loadGameSet(gamesRoot, tempDir('bp-cache-'));
  assert.equal(set.modules.length, 0);
  assert.equal(set.errors.length, 1);
  assert.match(set.errors[0].message, /版本/);
});
