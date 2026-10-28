import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRuleConfig } from '@lizardon386/core-abi';
import { ruleConfigDefaults, ruleConfigFromValues, ruleConfigSpec, ruleConfigSummary } from '@bp/client/rule-config.js';

const parsed = parseRuleConfig({
  fields: [
    { key: 'sudden-death', label: '突然死亡', type: 'boolean', default: true },
    {
      key: 'difficulty',
      label: '难度',
      type: 'enum',
      default: 'normal',
      options: [
        { value: 'easy', label: '简单' },
        { value: 'normal', label: '普通' },
      ],
    },
    { key: 'rounds', label: '回合数', type: 'integer', default: 8, min: 1, max: 20, step: 1 },
  ],
});
assert.equal(parsed.ok, true);
const spec = parsed.ok ? parsed.spec : { fields: [] };

test('规则表单：默认值来自 manifest 的 default', () => {
  assert.deepEqual(ruleConfigDefaults(spec), { 'sudden-death': true, difficulty: 'normal', rounds: 8 });
});

test('规则表单：布尔/枚举/整数按控件值收口，非法值回默认', () => {
  const values = ruleConfigFromValues(spec, (field) => {
    if (field.key === 'sudden-death') return false;
    if (field.key === 'difficulty') return 'easy';
    if (field.key === 'rounds') return '12';
    return undefined;
  });
  assert.deepEqual(values, { 'sudden-death': false, difficulty: 'easy', rounds: 12 });

  const invalid = ruleConfigFromValues(spec, (field) => {
    if (field.key === 'difficulty') return 'impossible';
    if (field.key === 'rounds') return '不是数字';
    return undefined;
  });
  assert.deepEqual(invalid, { 'sudden-death': true, difficulty: 'normal', rounds: 8 });
});

test('规则表单：超出 min/max 的值原样交给游戏 normalizeConfig 兜底', () => {
  const values = ruleConfigFromValues(spec, (field) => (field.key === 'rounds' ? '999' : undefined));
  assert.equal(values.rounds, 999);
});

test('规则摘要：按 manifest 字段顺序翻成中文', () => {
  assert.deepEqual(ruleConfigSummary(spec, { 'sudden-death': false, difficulty: 'easy', rounds: 12 }), [
    { key: 'sudden-death', label: '突然死亡', text: '关' },
    { key: 'difficulty', label: '难度', text: '简单' },
    { key: 'rounds', label: '回合数', text: '12' },
  ]);
});

test('规则表单：坏声明直接拒绝，不抛异常', () => {
  assert.equal(ruleConfigSpec({ fields: [{ key: 'Bad Key', label: 'x', type: 'boolean', default: true }] }), null);
});
