import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULE_CONFIG_LIMITS, parseRuleConfig } from '@lizardon386/core-abi';

function spec(fields) {
  return { fields };
}

test('rule-config：五个开关的典型声明通过', () => {
  const result = parseRuleConfig(
    spec([
      { key: 'no-mercy', label: '禁 mercy 规则', type: 'boolean', default: false, description: '开启后不能连续摸牌求和' },
      { key: 'stacking', label: '叠加 +2', type: 'boolean', default: true },
      {
        key: 'ai-level',
        label: '电脑难度',
        type: 'enum',
        default: 'normal',
        options: [
          { value: 'easy', label: '简单' },
          { value: 'normal', label: '普通', description: '默认难度' },
          { value: 'hard', label: '困难' },
        ],
      },
      { key: 'starting-cards', label: '起手牌数', type: 'integer', default: 7, min: 3, max: 12, step: 1 },
      { key: 'turn-seconds', label: '每手限时', type: 'integer', default: 30, min: 10, max: 120 },
    ]),
  );
  assert.equal(result.ok, true);
  assert.equal(result.spec.fields.length, 5);
  assert.equal(result.spec.fields[2].options[1].description, '默认难度');
  assert.equal(result.spec.fields[3].step, 1);
});

test('rule-config：字段数量与 key 规则', () => {
  assert.match(parseRuleConfig(spec([])).error, /至少要有一项/);
  const many = Array.from({ length: 25 }, (_, i) => ({ key: `f${i}`, label: '项', type: 'boolean', default: false }));
  assert.match(parseRuleConfig(spec(many)).error, /最多 24 项/);

  const badKey = (key) => parseRuleConfig(spec([{ key, label: '项', type: 'boolean', default: false }]));
  assert.equal(badKey('good-key').ok, true);
  assert.match(badKey('Bad').error, /key 必须匹配/);
  assert.match(badKey('1bad').error, /key 必须匹配/);
  assert.match(badKey('bad_key').error, /key 必须匹配/);
  assert.match(badKey('a'.repeat(33)).error, /key 必须匹配/);

  assert.match(
    parseRuleConfig(
      spec([
        { key: 'same', label: '一', type: 'boolean', default: false },
        { key: 'same', label: '二', type: 'boolean', default: true },
      ]),
    ).error,
    /key 与前面的字段重复/,
  );
});

test('rule-config：label 与 description 上限', () => {
  assert.match(
    parseRuleConfig(spec([{ key: 'a', label: '标'.repeat(41), type: 'boolean', default: false }])).error,
    /label 超过 40 字/,
  );
  assert.match(
    parseRuleConfig(spec([{ key: 'a', label: '', type: 'boolean', default: false }])).error,
    /label 不能为空/,
  );
  assert.match(
    parseRuleConfig(
      spec([{ key: 'a', label: '项', description: '说'.repeat(201), type: 'boolean', default: false }]),
    ).error,
    /description 超过 200 字/,
  );
});

test('rule-config：enum 的选项、默认值与上限', () => {
  const base = { key: 'mode', label: '模式', type: 'enum', default: 'a' };
  assert.equal(parseRuleConfig(spec([{ ...base, options: [{ value: 'a', label: 'A' }] }])).ok, true);
  assert.match(parseRuleConfig(spec([{ ...base, options: [] }])).error, /至少要有一个选项/);
  assert.match(
    parseRuleConfig(
      spec([{ ...base, options: Array.from({ length: 9 }, (_, i) => ({ value: `v${i}`, label: '项' })) }]),
    ).error,
    /最多 8 个选项/,
  );
  assert.match(
    parseRuleConfig(spec([{ ...base, options: [{ value: 'a_b', label: 'A' }] }])).error,
    /value 必须匹配/,
  );
  assert.match(
    parseRuleConfig(
      spec([
        {
          ...base,
          options: [
            { value: 'a', label: 'A' },
            { value: 'a', label: 'B' },
          ],
        },
      ]),
    ).error,
    /value 与前面的选项重复/,
  );
  assert.match(
    parseRuleConfig(spec([{ ...base, default: 'b', options: [{ value: 'a', label: 'A' }] }])).error,
    /default 必须是 options 里的某个 value/,
  );
  assert.match(
    parseRuleConfig(spec([{ ...base, options: [{ value: 'a', label: 'A'.repeat(25) }] }])).error,
    /label 超过 24 字/,
  );
});

test('rule-config：integer 的整数、范围与步长', () => {
  const make = (overrides = {}) => ({
    fields: [{ key: 'n', label: '数值', type: 'integer', default: 5, min: 1, max: 10, ...overrides }],
  });
  assert.equal(parseRuleConfig(make()).ok, true);
  assert.match(parseRuleConfig(make({ default: 1.5 })).error, /默认值必须是整数/);
  assert.match(parseRuleConfig(make({ min: 1.5 })).error, /min 必须是整数/);
  assert.match(parseRuleConfig(make({ min: 6 })).error, /min 不能大于 default/);
  assert.match(parseRuleConfig(make({ max: 4 })).error, /max 不能小于 default/);
  assert.match(parseRuleConfig(make({ max: 2000 })).error, /跨度最多 1000/);
  assert.match(parseRuleConfig(make({ step: 0 })).error, /step 必须是正整数/);
  assert.match(parseRuleConfig(make({ step: 1.5 })).error, /step 必须是正整数/);
});

test('rule-config：boolean 默认值与未知类型', () => {
  assert.match(
    parseRuleConfig(spec([{ key: 'b', label: '开', type: 'boolean', default: 'yes' }])).error,
    /默认值必须是布尔值/,
  );
  assert.match(
    parseRuleConfig(spec([{ key: 'b', label: '开', type: 'string', default: 'x' }])).error,
    /只支持 boolean \/ enum \/ integer/,
  );
  assert.match(parseRuleConfig([]).error, /规则表单声明必须是对象/);
  assert.match(parseRuleConfig({ fields: 'x' }).error, /fields 必须是数组/);
});

test('rule-config：上限常量与文档一致', () => {
  assert.deepEqual(RULE_CONFIG_LIMITS, {
    fields: 24,
    keyLength: 32,
    label: 40,
    description: 200,
    enumOptions: 8,
    enumValueLength: 32,
    enumLabel: 24,
    integerSpan: 1000,
  });
});
