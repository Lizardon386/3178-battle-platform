import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGameModule, manifestOf } from '@bp/server';

const base = {
  id: 'sample',
  name: '样本',
  version: '0.1.0',
  entry: 'client.js',
  seats: { min: 1, max: 2 },
  allowSpectate: false,
  soloFill: false,
  roles: ['host', 'player'],
  normalizeConfig: () => ({}),
  rulesHashOf: () => 'rules',
  create: () => ({}),
  resume: () => ({}),
};

test('模块可选携带 ui.chat，并原样进入 manifest', () => {
  assert.ok(isGameModule(base));
  assert.ok(isGameModule({ ...base, ui: { chat: 'game' } }));
  assert.deepEqual(manifestOf({ ...base, ui: { chat: 'game' } }, {}).ui, { chat: 'game' });
  assert.equal(manifestOf(base, {}).ui, undefined);
});

test('模块 ui 字段只允许 chat=platform|game，未知键拒绝', () => {
  assert.ok(!isGameModule({ ...base, ui: { chat: 'both' } }));
  assert.ok(!isGameModule({ ...base, ui: { chat: 'game', extra: true } }));
  assert.ok(!isGameModule({ ...base, ui: 'game' }));
});

test('模块可选携带 ruleConfig 与 reference，并原样进入 manifest', () => {
  const ruleConfig = {
    fields: [{ key: 'rounds', label: '回合数', type: 'integer', default: 8, min: 1, max: 20 }],
  };
  const reference = { entry: 'docs/reference.json' };
  const manifest = manifestOf({ ...base, ruleConfig, reference }, {});
  assert.deepEqual(manifest.ruleConfig, ruleConfig);
  assert.deepEqual(manifest.reference, reference);
  assert.equal(manifestOf(base, {}).ruleConfig, undefined);
  assert.equal(manifestOf(base, {}).reference, undefined);
});
