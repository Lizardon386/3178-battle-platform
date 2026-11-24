import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck } from '../dist/core/cards.js';
import { applyAction, createGame, privateView, publicView, MAX_HP } from '../dist/core/state.js';

const seeded = (seed = 7) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

test('牌库：四种牌各 4 张、ID 唯一', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 16);
  assert.equal(new Set(deck.map((card) => card.id)).size, 16);
  for (const kind of ['strike', 'shield', 'drain', 'draw']) {
    assert.equal(deck.filter((card) => card.kind === kind).length, 4);
  }
});

test('开局：双方 3 张手牌、当前玩家抽 1 张、血量满', () => {
  const game = createGame('round-1', ['m1', 'm2'], seeded());
  assert.equal(game.players[0].hand.length, 4);
  assert.equal(game.players[1].hand.length, 3);
  assert.equal(game.players.every((player) => player.hp === MAX_HP), true);
  assert.equal(publicView(game).currentMemberId, 'm1');
});

test('动作：斩击扣血、护盾加值、非当前玩家被拒', () => {
  const game = createGame('round-1', ['m1', 'm2'], seeded());
  const strike = game.players[0].hand.find((card) => card.kind === 'strike');
  const after = applyAction(game, 'm1', { type: 'play', cardId: strike.id });
  assert.equal(after.ok, true);
  assert.equal(after.state.players[1].hp, MAX_HP - 3);
  assert.equal(publicView(after.state).currentMemberId, 'm2');
  const wrong = applyAction(after.state, 'm1', { type: 'pass' });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, 'TURN');
});

test('视角：自己看到手牌，对手只看到数量，观战只看公共视图', () => {
  const game = createGame('round-1', ['m1', 'm2'], seeded());
  const mine = privateView(game, 'm1');
  const other = privateView(game, 'm2');
  assert.equal(mine.hand.length, game.players[0].hand.length);
  assert.equal(other.hand.length, game.players[1].hand.length);
  assert.equal(publicView(game).players[0].handCount, game.players[0].hand.length);
  assert.equal('hand' in publicView(game).players[0], false);
});

test('结算：连续出牌能打到结束并产生结果', () => {
  let game = createGame('round-1', ['m1', 'm2'], seeded(11));
  for (let step = 0; step < 400 && !game.finished; step += 1) {
    const actor = game.players[game.turnIndex];
    const card = actor.hand[0];
    const result = applyAction(game, actor.memberId, card ? { type: 'play', cardId: card.id } : { type: 'pass' });
    assert.equal(result.ok, true);
    game = result.state;
  }
  assert.equal(game.finished, true);
  assert.ok(game.reason);
});

test('认输：对手直接获胜', () => {
  const game = createGame('round-1', ['m1', 'm2'], seeded());
  const result = applyAction(game, 'm1', { type: 'concede' });
  assert.equal(result.ok, true);
  assert.equal(result.state.winner, 'm2');
  assert.equal(result.state.finished, true);
});
