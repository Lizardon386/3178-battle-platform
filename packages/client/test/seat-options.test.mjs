import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seatOptionFields, seatOptionsSpec, seatOptionLabel, seatOptionValues } from '@bp/client/seat-options.js';

const raw = {
  fields: [
    { key: 'difficulty', label: '电脑强度', type: 'enum', roles: ['ai'], default: 'normal', options: [{ value: 'easy', label: '简单' }, { value: 'normal', label: '普通' }] },
    { key: 'color', label: '颜色', type: 'enum', roles: ['host', 'player', 'ai'], default: 'red', options: [{ value: 'red', label: '红', color: '#ef4444' }, { value: 'blue', label: '蓝', color: '#3b82f6' }] },
    { key: 'bonus', label: '加成', type: 'integer', roles: ['ai'], default: 1, min: 0, max: 5 },
  ],
};
const spec = seatOptionsSpec(raw);
assert.ok(spec);

test('座位选项：按角色过滤字段', () => {
  assert.deepEqual(seatOptionFields(spec, 'player').map((f) => f.key), ['color']);
  assert.deepEqual(seatOptionFields(spec, 'ai').map((f) => f.key), ['difficulty', 'color', 'bonus']);
});

test('座位选项：控件值收口，非法值回 default', () => {
  const fields = seatOptionFields(spec, 'ai');
  assert.deepEqual(seatOptionValues(fields, (field) => {
    if (field.key === 'difficulty') return 'easy';
    if (field.key === 'color') return 'blue';
    if (field.key === 'bonus') return '4';
    return undefined;
  }), { difficulty: 'easy', color: 'blue', bonus: 4 });
  assert.deepEqual(seatOptionValues(fields, (field) => (field.key === 'color' ? 'purple' : undefined)), {
    difficulty: 'normal',
    color: 'red',
    bonus: 1,
  });
});

test('座位选项：摘要用游戏给的 label', () => {
  assert.equal(seatOptionLabel(seatOptionFields(spec, 'ai')[0], 'easy'), '简单');
  assert.equal(seatOptionLabel(seatOptionFields(spec, 'ai')[1], 'blue'), '蓝');
  assert.equal(seatOptionsSpec({ fields: [] }), null);
});
