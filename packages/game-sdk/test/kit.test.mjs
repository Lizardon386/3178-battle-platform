import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  API_VERSION,
  DEFAULT_MODE,
  GAME_MODES,
  SUPPORTED_API_VERSIONS,
  SUPPORTED_MODES,
} from '@bp/game-sdk';
import { FEED_EVENT, FeedLog } from '@bp/game-sdk/kit/server';
import {
  FeedPanel,
  formatFeedTime,
  mergeFeedEntries,
  normalizeFeedEntry,
  seatColor,
} from '@bp/game-sdk/kit';

test('事件流：全员事件广播、序号递增、drain 只取一次', () => {
  let now = 1_000;
  const feed = new FeedLog({ now: () => now });
  const first = feed.emit({ type: 'turn', text: '轮到甲' });
  assert.deepEqual(first, { seq: 1, at: 1_000, type: 'turn', text: '轮到甲' });
  now = 1_200;
  const second = feed.emit({ type: 'recall', text: '乙 回城' });
  assert.equal(second.seq, 2);
  assert.equal(second.at, 1_200);
  assert.deepEqual(feed.drainEffects(), [
    { kind: 'broadcast', name: FEED_EVENT, payload: first },
    { kind: 'broadcast', name: FEED_EVENT, payload: second },
  ]);
  assert.deepEqual(feed.drainEffects(), []);
});

test('事件流：seat 可见性只发给本人，观战看不到', () => {
  const feed = new FeedLog({ now: () => 1 });
  feed.emit({ type: 'turn', text: '全员' });
  feed.emit({ type: 'secret', text: '只有甲知道', visibility: { seatId: 's1' } });
  assert.deepEqual(feed.viewFor('s1').map((entry) => entry.type), ['turn', 'secret']);
  assert.deepEqual(feed.viewFor('s2').map((entry) => entry.type), ['turn']);
  assert.deepEqual(feed.viewFor(null).map((entry) => entry.type), ['turn']);
  const effects = feed.drainEffects();
  assert.deepEqual(effects[1], {
    kind: 'toSeat',
    seatId: 's1',
    name: FEED_EVENT,
    payload: feed.viewFor('s1')[1],
  });
});

test('事件流：team 可见性按当前队伍发给队友，不发给对手或观战', () => {
  const seats = () => [
    { seatId: 's1', team: 'red' },
    { seatId: 's2', team: 'blue' },
    { seatId: 's3', team: 'red' },
  ];
  const feed = new FeedLog({ now: () => 1, seatTeams: seats });
  feed.emit({ type: 'team', text: '红队集合', visibility: { team: 'red' } });
  assert.deepEqual(feed.viewFor('s1').map((entry) => entry.type), ['team']);
  assert.deepEqual(feed.viewFor('s3').map((entry) => entry.type), ['team']);
  assert.deepEqual(feed.viewFor('s2').map((entry) => entry.type), []);
  assert.deepEqual(feed.viewFor(null).map((entry) => entry.type), []);
  const effects = feed.drainEffects();
  assert.deepEqual(effects.map((effect) => effect.seatId).sort(), ['s1', 's3']);
  assert.ok(effects.every((effect) => effect.kind === 'toSeat' && effect.name === FEED_EVENT));
});

test('事件流：历史上限、文本截断、坏输入拒绝', () => {
  const feed = new FeedLog({ max: 2, maxText: 5, now: () => 1 });
  feed.emit({ type: 'a', text: '123456789' });
  feed.emit({ type: 'b', text: 'b' });
  feed.emit({ type: 'c', text: 'c' });
  const entries = feed.viewFor(null);
  assert.deepEqual(entries.map((entry) => entry.seq), [2, 3]);
  assert.equal(entries[0].text, 'b');
  assert.throws(() => feed.emit({ type: 'x', text: '   ' }), /text/);
  assert.throws(() => feed.emit({ type: 'x', text: 'x', visibility: { team: 'red' } }), /seatTeams/);
  assert.throws(() => feed.emit({ type: 'x', text: 'x', visibility: { seatId: '' } }), /seatId/);
});

test('事件流：快照恢复后序号继续，不丢可见性', () => {
  const feed = new FeedLog({ now: () => 9 });
  feed.emit({ type: 'a', text: '全员' });
  feed.emit({ type: 'b', text: '甲的秘密', visibility: { seatId: 's1' } });
  const restored = new FeedLog({ now: () => 10 });
  restored.restore(feed.snapshot());
  assert.deepEqual(restored.viewFor('s1').map((entry) => entry.type), ['a', 'b']);
  assert.deepEqual(restored.viewFor('s2').map((entry) => entry.type), ['a']);
  const next = restored.emit({ type: 'c', text: '继续' });
  assert.equal(next.seq, 3);
});

test('FeedPanel：seq 去重、排序、历史上限，headless 不碰 DOM', () => {
  const seen = [];
  const panel = new FeedPanel({ max: 2, onEntry: (entry) => seen.push(entry.type) });
  panel.setEntries([
    { seq: 2, at: 2, type: 'b', text: '乙' },
    { seq: 1, at: 1, type: 'a', text: '甲' },
  ]);
  panel.append({ seq: 2, at: 2, type: 'b', text: '乙' });
  panel.append({ seq: 3, at: 3, type: 'c', text: '丙' });
  panel.append({ seq: 4, at: 4, type: 'd', text: '丁' });
  assert.deepEqual(seen, ['c', 'd']);
  assert.equal(panel.handleEvent({ name: FEED_EVENT, payload: { seq: 5, at: 5, type: 'e', text: '戊' } }), true);
  assert.equal(panel.handleEvent({ name: 'other', payload: {} }), false);
  assert.deepEqual(seen, ['c', 'd', 'e']);
});

test('事件流工具函数：归并与校验', () => {
  const normalized = normalizeFeedEntry({ seq: 1, at: 1, type: ' a ', text: ' x ', actor: 's1' });
  assert.deepEqual(normalized, { seq: 1, at: 1, type: 'a', text: 'x', actor: 's1' });
  assert.equal(normalizeFeedEntry({ seq: 0, at: 1, type: 'a', text: 'x' }), null);
  assert.equal(normalizeFeedEntry({ seq: 1, at: 1, type: 'a', text: '' }), null);
  assert.deepEqual(
    mergeFeedEntries(
      [{ seq: 2, at: 2, type: 'b', text: 'b' }],
      [{ seq: 1, at: 1, type: 'a', text: 'a' }, { seq: 2, at: 2, type: 'b2', text: 'b2' }],
      2,
    ).map((entry) => entry.type),
    ['a', 'b2'],
  );
});

test('座位颜色：同输入稳定，队伍优先于座位号', () => {
  const a = seatColor({ seatId: 's1', slot: 1, team: null });
  const b = seatColor({ seatId: 's2', slot: 1, team: null });
  assert.deepEqual(a, b);
  assert.notEqual(seatColor({ seatId: 's1', slot: 1, team: 'red' }).value, seatColor({ seatId: 's2', slot: 2, team: 'blue' }).value);
  assert.deepEqual(seatColor({ seatId: 's1', slot: 1, team: 'red' }), seatColor({ seatId: 's2', slot: 2, team: 'red' }));
  assert.match(a.value, /^#[0-9a-f]{6}$/i);
  assert.match(formatFeedTime(0), /^\d{2}:\d{2}:\d{2}$/);
});

test('包入口：版本常量从根路径可取', () => {
  assert.equal(API_VERSION, 1);
  assert.deepEqual(SUPPORTED_API_VERSIONS, [1]);
  assert.deepEqual(GAME_MODES, ['turn', 'realtime']);
  assert.equal(DEFAULT_MODE, 'turn');
  assert.deepEqual(SUPPORTED_MODES, { turn: [1], realtime: [] });
});
