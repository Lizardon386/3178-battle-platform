import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { CanonicalJsonError, canonicalJson, rulesHashOf } from '../dist/protocol-v0/canonical-json.js';
import { normalizeFields, validateFieldSpecs } from '../dist/protocol-v0/normalize-config.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../protocol/v0');
const pythonScript = path.resolve(rootDir, '../../tools/testkit/fixtures/protocol-v0/canonical_json.py');
const read = (name) => JSON.parse(fs.readFileSync(path.join(rootDir, name), 'utf8'));

function python(input, extra = []) {
  return spawnSync('python', ['-I', '-X', 'utf8', pythonScript, ...extra], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
}

const canonicalGolden = read('golden/canonical-json.json');
const normalizeGolden = read('golden/config-normalize.json');

test('canonical JSON：TS 与 golden 的字节和 SHA-256 一致', () => {
  for (const vector of canonicalGolden.vectors) {
    assert.equal(canonicalJson(vector.input), vector.canonical, vector.name);
    assert.equal(rulesHashOf(vector.input), vector.sha256, vector.name);
  }
});

test('canonical JSON：Python 实现与 golden 逐字节一致', () => {
  for (const vector of canonicalGolden.vectors) {
    const run = python(vector.input);
    assert.equal(run.status, 0, `${vector.name}: ${run.stderr}`);
    assert.equal(run.stdout.replace(/\r?\n$/, ''), vector.canonical, vector.name);
    const hashed = python(vector.input, ['--hash']);
    assert.equal(hashed.status, 0, `${vector.name}: ${hashed.stderr}`);
    assert.equal(hashed.stdout.replace(/\r?\n$/, ''), vector.sha256, vector.name);
  }
});

test('canonical JSON：非法输入在 TS 与 Python 都拒绝', () => {
  for (const vector of canonicalGolden.invalid) {
    assert.throws(() => canonicalJson(vector.input), (error) => {
      assert.ok(error instanceof CanonicalJsonError, vector.name);
      assert.ok(error.message.includes(vector.errorContains), `${vector.name}: ${error.message}`);
      return true;
    });
    const run = python(vector.input);
    assert.notEqual(run.status, 0, vector.name);
    assert.ok((run.stderr || '').includes(vector.errorContains), `${vector.name}: ${run.stderr}`);
  }
});

test('canonical JSON：类型、循环与稀疏数组只在 TS 侧拒绝', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const cases = [
    [Number.NaN, /finite/],
    [Number.POSITIVE_INFINITY, /finite/],
    [undefined, /unsupported value type/],
    [{ a: undefined }, /unsupported value type/],
    [new Date(0), /plain object/],
    [cyclic, /circular/],
    [[, 1], /unsupported value type/],
    [{ [Symbol('x')]: 1 }, /symbol keys/],
    [1n, /unsupported value type/],
  ];
  for (const [value, pattern] of cases) {
    assert.throws(() => canonicalJson(value), pattern);
  }
});

test('配置规范化：golden 向量逐个通过或按预期拒绝', () => {
  for (const vector of normalizeGolden.vectors) {
    const result = normalizeFields(normalizeGolden.fields, vector.raw);
    if (vector.errorContains) {
      assert.equal(result.ok, false, vector.name);
      assert.ok(result.error.includes(vector.errorContains), `${vector.name}: ${result.error}`);
    } else {
      assert.equal(result.ok, true, vector.name);
      assert.deepEqual(result.value, vector.expected, vector.name);
    }
  }
});

test('座位选项：按角色过滤，未声明的键拒绝', () => {
  for (const vector of normalizeGolden.seatVectors) {
    const result = normalizeFields(normalizeGolden.seatFields, vector.raw, vector.role);
    if (vector.errorContains) {
      assert.equal(result.ok, false, vector.name);
      assert.ok(result.error.includes(vector.errorContains), `${vector.name}: ${result.error}`);
    } else {
      assert.equal(result.ok, true, vector.name);
      assert.deepEqual(result.value, vector.expected, vector.name);
    }
  }
});

test('字段声明：合法声明通过，非法类型、重复键与坏默认值被拒', () => {
  assert.equal(validateFieldSpecs(normalizeGolden.fields, 24), null);
  assert.equal(validateFieldSpecs(normalizeGolden.seatFields, 8), null);
  assert.match(validateFieldSpecs([{ key: 'x', type: 'number', label: 'X', default: 1 }], 24), /boolean \/ enum \/ integer/);
  assert.match(validateFieldSpecs([
    { key: 'x', type: 'boolean', label: 'X', default: true },
    { key: 'x', type: 'boolean', label: 'Y', default: false },
  ], 24), /重复/);
  assert.match(validateFieldSpecs([
    { key: 'x', type: 'enum', label: 'X', default: 'z', options: [{ value: 'a', label: 'A' }] },
  ], 24), /options/);
  assert.match(validateFieldSpecs([
    { key: 'x', type: 'integer', label: 'X', default: 5, min: 1, max: 4 },
  ], 24), /max/);
  assert.match(validateFieldSpecs([
    { key: 'x', type: 'integer', label: 'X', default: 1, min: 1, max: 1002 },
  ], 24), /跨度/);
});
