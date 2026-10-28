import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChatPanel,
  ScoreboardPanel,
  buildScoreboardRows,
  chatLineKey,
  chatText,
  connectionLabel,
  formatColumnValue,
  mergeChatLines,
  normalizeChatLine,
  normalizeScoreboardRows,
  resolveColumnValue,
  sortScoreboardRows,
} from '@lizardon386/game-sdk/kit';

const seat = (over = {}) => ({
  seatId: 's1',
  slot: 1,
  name: '甲',
  role: 'player',
  ready: true,
  connected: true,
  ageMs: 0,
  team: null,
  isHost: false,
  ...over,
});

test('聊天：文本上限、行校验、去重与历史上限', () => {
  assert.equal(chatText('  你好  '), '你好');
  assert.equal(chatText(''), null);
  assert.equal(chatText('x'.repeat(301)), null);

  const line = { seatId: 's1', name: '甲', text: '你好', at: 1, kind: 'say' };
  assert.deepEqual(normalizeChatLine(line), line);
  assert.equal(normalizeChatLine({ ...line, kind: 'whisper' }), null);
  assert.equal(normalizeChatLine({ ...line, text: '   ' }), null);
  assert.equal(chatLineKey(line), '1|s1|say|你好');

  const merged = mergeChatLines(
    [{ ...line, at: 2, text: '乙' }],
    [line, { ...line, at: 3, text: '丙' }],
    2,
  );
  assert.deepEqual(merged.map((item) => item.text), ['乙', '丙']);
});

test('聊天面板：历史替换、增量去重、onLine 只回报新消息', () => {
  const seen = [];
  const chat = new ChatPanel({ onLine: (line) => seen.push(line.text) });
  chat.setLines([
    { seatId: 's1', name: '甲', text: '历史', at: 1, kind: 'say' },
  ]);
  chat.append({ seatId: 's2', name: '乙', text: '新消息', at: 2, kind: 'say' });
  chat.append({ seatId: 's2', name: '乙', text: '新消息', at: 2, kind: 'say' });
  assert.deepEqual(seen, ['新消息']);
  chat.clear();
  assert.deepEqual(seen, ['新消息']);
});

test('记分板：座位是主列表，没有游戏行的座位也显示，未知行排后面', () => {
  const rows = normalizeScoreboardRows([
    { seatId: 's1', values: { score: 5 } },
    { seatId: 's3', values: { score: 1 } },
    { seatId: '', values: {} },
    { seatId: 'bad', values: [] },
  ]);
  assert.deepEqual(rows.map((row) => row.seatId), ['s1', 's3']);
  const built = buildScoreboardRows(rows, [
    seat({ seatId: 's2', slot: 2, name: '乙' }),
    seat({ seatId: 's1', slot: 1 }),
  ]);
  assert.deepEqual(built.map((row) => row.seatId), ['s1', 's2', 's3']);
  assert.deepEqual(built[1].values, {});
});

test('记分板：列值支持字段名、函数和默认 key，空值显示破折号', () => {
  const row = { seatId: 's1', values: { hand: 3, score: 10, state: '思考中' } };
  assert.equal(resolveColumnValue({ key: 'hand', label: '手牌', value: 'hand' }, row), 3);
  assert.equal(resolveColumnValue({ key: 'score', label: '分数' }, row), 10);
  assert.equal(resolveColumnValue({ key: 'x', label: 'X', value: (r) => r.values.score * 2 }, row), 20);
  assert.equal(formatColumnValue({ key: 'missing', label: '缺失' }, row), '—');
  assert.equal(formatColumnValue({ key: 'score', label: '分数', format: (v) => `${v} 分` }, row), '10 分');
});

test('记分板：排序只对已知列生效，升降序稳定，缺值排最后', () => {
  const columns = [{ key: 'score', label: '分数' }];
  const rows = [
    { seatId: 's1', values: { score: 3 } },
    { seatId: 's2', values: { score: 1 } },
    { seatId: 's3', values: { score: 2 } },
    { seatId: 's4', values: {} },
  ];
  assert.deepEqual(
    sortScoreboardRows(rows, columns, { key: 'score', dir: 'desc' }).map((row) => row.seatId),
    ['s1', 's3', 's2', 's4'],
  );
  assert.deepEqual(
    sortScoreboardRows(rows, columns, { key: 'missing', dir: 'asc' }).map((row) => row.seatId),
    ['s1', 's2', 's3', 's4'],
  );
});

test('记分板：电脑座位显示“电脑”，不显示离线；观战显示“观战”', () => {
  assert.equal(connectionLabel(seat({ role: 'ai', connected: false })), '电脑');
  assert.equal(connectionLabel(seat({ role: 'spectator', connected: true })), '观战');
  assert.equal(connectionLabel(seat({ role: 'player', connected: true })), '在线');
  assert.equal(connectionLabel(seat({ role: 'player', connected: false })), '离线');
  assert.equal(connectionLabel(undefined), '—');
});

test('记分板面板：无 DOM 时也能更新状态，不抛异常', () => {
  const board = new ScoreboardPanel({
    columns: [{ key: 'score', label: '分数' }],
    showTeam: true,
    showConnection: true,
  });
  board.setRows([{ seatId: 's1', values: { score: 9 } }]);
  board.setSeats([seat({ team: 1 })]);
  board.setRoom({ code: 'AB12', phase: 'playing', seats: [seat()] });
  board.setSort({ key: 'score', dir: 'desc' });
  board.clear();
  board.destroy();
});
