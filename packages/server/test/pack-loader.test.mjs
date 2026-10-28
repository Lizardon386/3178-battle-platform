import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadGameSet, packDirectory, readPackSource } from '@bp/server';

const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function moduleSourceDir(id, version, extra = {}) {
  const dir = tempDir('bp-module-');
  const bpmap = { id, version, server: 'server.js', client: 'client.js' };
  if (extra.reference) bpmap.reference = extra.reference;
  writeFileSync(join(dir, 'bpmap.json'), JSON.stringify(bpmap), 'utf8');
  const declarations = [
    extra.ruleConfig ? `  ruleConfig: ${JSON.stringify(extra.ruleConfig)},` : '',
    extra.reference ? `  reference: ${JSON.stringify(extra.reference)},` : '',
  ].filter(Boolean).join('\n');
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
${declarations}
  normalizeConfig: () => ({}),
  rulesHashOf: () => 'rules',
  create: () => instance,
  resume: () => instance,
};
`,
    'utf8',
  );
  writeFileSync(join(dir, 'client.js'), 'export default { mount() {} };\n', 'utf8');
  if (extra.reference) {
    const referencePath = join(dir, ...extra.reference.entry.split('/'));
    mkdirSync(dirname(referencePath), { recursive: true });
    writeFileSync(referencePath, extra.referenceText ?? '{"version":1,"groups":[{"id":"g","title":"组","items":[{"text":"条目"}]}]}', 'utf8');
  }
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

  const assets = set.assets.get('sample');
  assert.ok(assets);
  assert.ok(assets.some((asset) => asset.path === 'client.js' && asset.hash.startsWith('sha256:')));
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

test('单文件包：不支持的模式或 apiVersion 在解包前跳过', async () => {
  const gamesRoot = tempDir('bp-games-');
  const source = moduleSourceDir('sample', '0.1.0');
  packDirectory(source, join(gamesRoot, 'realtime.bpmap'), {
    ...readPackSource(source),
    mode: 'realtime',
    apiVersion: 1,
  });
  packDirectory(source, join(gamesRoot, 'api2.bpmap'), {
    ...readPackSource(source),
    mode: 'turn',
    apiVersion: 2,
  });

  const set = await loadGameSet(gamesRoot, tempDir('bp-cache-'));
  assert.equal(set.modules.length, 0);
  assert.equal(set.errors.length, 2);
  assert.ok(set.errors.some((error) => /模式 realtime/.test(error.message)));
  assert.ok(set.errors.some((error) => /apiVersion 2/.test(error.message)));
});

test('单文件包：ruleConfig / reference 随模块加载，资料文档先校验', async () => {
  const gamesRoot = tempDir('bp-games-');
  const ruleConfig = { fields: [{ key: 'rounds', label: '回合数', type: 'integer', default: 8, min: 1, max: 20 }] };
  const reference = { entry: 'docs/reference.json' };
  const source = moduleSourceDir('declared', '0.1.0', { ruleConfig, reference });
  packDirectory(source, join(gamesRoot, 'declared.bpmap'), readPackSource(source));

  const set = await loadGameSet(gamesRoot, tempDir('bp-cache-'));
  assert.equal(set.errors.length, 0);
  assert.equal(set.modules.length, 1);
  assert.deepEqual(set.modules[0].ruleConfig, ruleConfig);
  assert.deepEqual(set.modules[0].reference, reference);
});

test('单文件包：坏规则表单 / 坏资料文档跳过模块并记录错误', async () => {
  const gamesRoot = tempDir('bp-games-');
  const badRule = moduleSourceDir('bad-rule', '0.1.0', {
    ruleConfig: {
      fields: [{ key: 'mode', label: '模式', type: 'enum', default: 'missing', options: [{ value: 'a', label: 'A' }] }],
    },
  });
  const badRef = moduleSourceDir('bad-ref', '0.1.0', {
    reference: { entry: 'docs/reference.json' },
    referenceText: '{not json',
  });
  packDirectory(badRule, join(gamesRoot, 'bad-rule.bpmap'), readPackSource(badRule));
  packDirectory(badRef, join(gamesRoot, 'bad-ref.bpmap'), readPackSource(badRef));

  const set = await loadGameSet(gamesRoot, tempDir('bp-cache-'));
  assert.equal(set.modules.length, 0);
  assert.equal(set.errors.length, 2);
  assert.ok(set.errors.some((error) => /规则表单声明不合法/.test(error.message)));
  assert.ok(set.errors.some((error) => /资料文档不合法/.test(error.message)));
});
