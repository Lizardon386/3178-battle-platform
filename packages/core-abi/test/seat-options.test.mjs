import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEAT_OPTIONS_LIMITS, parseSeatOptions } from '@lizardon386/core-abi';

function spec(fields) {
  return { fields };
}

test('seat-options：难度与颜色两个字段的典型声明通过', () => {
  const result = parseSeatOptions(
    spec([
      {
        key: 'difficulty',
        label: '电脑难度',
        type: 'enum',
        roles: ['ai'],
        default: 'normal',
        options: [
          { value: 'easy', label: '简单' },
          { value: 'normal', label: '普通' },
          { value: 'cold', label: '冷酷' },
        ],
      },
      {
        key: 'color',
        label: '座位颜色',
        type: 'enum',
        roles: ['host', 'player', 'ai'],
        default: 'red',
        description: '只影响界面色块',
        options: [
          { value: 'red', label: '红', color: '#ef4444' },
          { value: 'yellow', label: '黄', color: '#f59e0b' },
          { value: 'green', label: '绿', color: '#22c55e' },
          { value: 'blue', label: '蓝', color: '#3b82f6' },
        ],
      },
    ]),
  );
  assert.equal(result.ok, true);
  assert.equal(result.spec.fields.length, 2);
  assert.deepEqual(result.spec.fields[0].roles, ['ai']);
  assert.equal(result.spec.fields[1].options[0].color, '#ef4444');
  assert.equal(result.spec.fields[1].description, '只影响界面色块');
});

test('seat-options：boolean 与 integer 字段', () => {
  const result = parseSeatOptions(
    spec([
      { key: 'ready-bot', label: '自动准备', type: 'boolean', roles: ['ai'], default: false },
      { key: 'hand-size', label: '起手牌数', type: 'integer', roles: ['player', 'ai'], default: 7, min: 3, max: 12, step: 1 },
    ]),
  );
  assert.equal(result.ok, true);
  assert.equal(result.spec.fields[1].step, 1);
});

test('seat-options：字段数量与 key 规则', () => {
  assert.match(parseSeatOptions(spec([])).error, /至少要有一项/);
  const many = Array.from({ length: 25 }, (_, i) => ({
    key: `f${i}`,
    label: '项',
    type: 'boolean',
    roles: ['player'],
    default: false,
  }));
  assert.match(parseSeatOptions(spec(many)).error, /最多 24 项/);

  const badKey = (key) =>
    parseSeatOptions(spec([{ key, label: '项', type: 'boolean', roles: ['player'], default: false }]));
  assert.equal(badKey('good-key').ok, true);
  assert.match(badKey('Bad').error, /key 必须匹配/);
  assert.match(badKey('1bad').error, /key 必须匹配/);
  assert.match(badKey('bad_key').error, /key 必须匹配/);
  assert.match(
    parseSeatOptions(
      spec([
        { key: 'same', label: '一', type: 'boolean', roles: ['player'], default: false },
        { key: 'same', label: '二', type: 'boolean', roles: ['player'], default: true },
      ]),
    ).error,
    /key 与前面的字段重复/,
  );
});

test('seat-options：roles 必须非空且只来自 SeatRole', () => {
  const make = (roles) => spec([{ key: 'a', label: '项', type: 'boolean', roles, default: false }]);
  assert.match(parseSeatOptions(make([])).error, /至少要有一个角色/);
  assert.match(parseSeatOptions(make(['guest'])).error, /只允许 host \/ player \/ spectator \/ ai/);
  assert.match(parseSeatOptions(make(['ai', 'ai'])).error, /角色重复/);
  assert.equal(parseSeatOptions(make(['host', 'spectator'])).ok, true);
});

test('seat-options：label 与 description 上限', () => {
  assert.match(
    parseSeatOptions(spec([{ key: 'a', label: '标'.repeat(41), type: 'boolean', roles: ['ai'], default: false }])).error,
    /label 超过 40 字/,
  );
  assert.match(
    parseSeatOptions(
      spec([{ key: 'a', label: '项', description: '说'.repeat(201), type: 'boolean', roles: ['ai'], default: false }]),
    ).error,
    /description 超过 200 字/,
  );
});

test('seat-options：enum 的选项、默认值、color 与上限', () => {
  const base = { key: 'color', label: '颜色', type: 'enum', roles: ['player'], default: 'red' };
  assert.equal(parseSeatOptions(spec([{ ...base, options: [{ value: 'red', label: '红' }] }])).ok, true);
  assert.match(parseSeatOptions(spec([{ ...base, options: [] }])).error, /至少要有一个选项/);
  assert.match(
    parseSeatOptions(
      spec([{ ...base, options: Array.from({ length: 9 }, (_, i) => ({ value: `v${i}`, label: '项' })) }]),
    ).error,
    /最多 8 个选项/,
  );
  assert.match(
    parseSeatOptions(spec([{ ...base, options: [{ value: 'red', label: '红' }, { value: 'red', label: '红2' }] }])).error,
    /value 与前面的选项重复/,
  );
  assert.match(
    parseSeatOptions(spec([{ ...base, default: 'blue', options: [{ value: 'red', label: '红' }] }])).error,
    /default 必须是 options 里的某个 value/,
  );
  assert.match(
    parseSeatOptions(spec([{ ...base, options: [{ value: 'red', label: '红', color: '' }] }])).error,
    /color 不能为空/,
  );
  assert.match(
    parseSeatOptions(spec([{ ...base, options: [{ value: 'red', label: '红', color: 'x'.repeat(65) }] }])).error,
    /color 超过 64 字/,
  );
  assert.match(
    parseSeatOptions(spec([{ ...base, options: [{ value: 'red', label: '红', color: 1 }] }])).error,
    /color 必须是字符串/,
  );
});

test('seat-options：integer 的整数、范围与步长', () => {
  const make = (overrides = {}) => ({
    fields: [{ key: 'n', label: '数值', type: 'integer', roles: ['ai'], default: 5, min: 1, max: 10, ...overrides }],
  });
  assert.equal(parseSeatOptions(make()).ok, true);
  assert.match(parseSeatOptions(make({ default: 1.5 })).error, /默认值必须是整数/);
  assert.match(parseSeatOptions(make({ min: 6 })).error, /min 不能大于 default/);
  assert.match(parseSeatOptions(make({ max: 4 })).error, /max 不能小于 default/);
  assert.match(parseSeatOptions(make({ max: 2000 })).error, /跨度最多 1000/);
  assert.match(parseSeatOptions(make({ step: 0 })).error, /step 必须是正整数/);
});

test('seat-options：boolean 默认值与未知类型', () => {
  assert.match(
    parseSeatOptions(spec([{ key: 'b', label: '开', type: 'boolean', roles: ['ai'], default: 'yes' }])).error,
    /默认值必须是布尔值/,
  );
  assert.match(
    parseSeatOptions(spec([{ key: 'b', label: '开', type: 'string', roles: ['ai'], default: 'x' }])).error,
    /只支持 boolean \/ enum \/ integer/,
  );
  assert.match(parseSeatOptions([]).error, /座位选项声明必须是对象/);
  assert.match(parseSeatOptions({ fields: 'x' }).error, /fields 必须是数组/);
});

test('seat-options：上限常量与文档一致', () => {
  assert.deepEqual(SEAT_OPTIONS_LIMITS, {
    fields: 24,
    keyLength: 32,
    label: 40,
    description: 200,
    enumOptions: 8,
    enumValueLength: 32,
    enumLabel: 24,
    integerSpan: 1000,
    colorLength: 64,
  });
});
