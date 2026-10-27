import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, harness } from '@bp/testkit/contract-harness';
import kitGame from '@bp/testkit/test-games/kit-client';

/**
 * fixture-kit 的随机动作猴测：只发动作和帧，不按剧本走。
 * 每一步检查事件流序号、记分板行数、拒绝码和计数是否自洽；
 * seed 固定，红掉时照最后的 seed/steps 复现。
 */

const SEED = 20261027;
const STEPS = 300;

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

test('fixture-kit 猴测：随机动作下事件流、记分板和拒绝保持自洽', () => {
  const random = rng(SEED);
  const spec = { module: kitGame, config: {}, seatSlots: 2 };
  const h = harness(spec);
  const host = createRoom(h, spec);
  const code = host.rec.last('snapshot').room.code;
  const guest = h.join('客人');
  guest.send({ type: 'roomJoin', code });
  guest.send({ type: 'ready', ready: true });
  host.send({ type: 'hostStart' });

  const players = [host, guest];
  let expectedCount = 0;
  const pick = () => players[Math.floor(random() * players.length)];
  const context = (step) => `seed=${SEED} step=${step}`;

  for (let step = 0; step < STEPS; step += 1) {
    const who = pick();
    const roll = random();
    if (roll < 0.55) {
      who.send({ type: 'gameAction', name: 'bump' });
      expectedCount += 1;
    } else if (roll < 0.7) {
      who.send({ type: 'gameAction', name: 'fixture-reject' });
      assert.equal(who.rec.last('error')?.code, 'BADMSG', `${context(step)} 非法动作要回 BADMSG`);
    } else if (roll < 0.8) {
      who.send({ type: 'gameAction', name: `unknown-${step}` });
      assert.equal(who.rec.last('error')?.code, 'BADMSG', `${context(step)} 未知动作要回 BADMSG`);
    } else if (roll < 0.95) {
      who.send({ type: 'chat', text: `猴 ${step}` });
    } else {
      who.send({ type: 'ping', nonce: `m${step}` });
    }

    if (random() < 0.08) h.step(Math.floor(random() * 200));

    for (const player of players) {
      const snapshot = player.rec.last('snapshot');
      if (!snapshot?.game) continue;
      assert.equal(snapshot.game.count, expectedCount, `${context(step)} 计数与成功 bump 次数不一致`);
      assert.equal(
        snapshot.game.scoreboard.rows.length,
        snapshot.seats.length,
        `${context(step)} 记分板行数应覆盖全部座位`,
      );
      const feed = snapshot.game.feed;
      assert.ok(Array.isArray(feed), `${context(step)} 快照里没有事件流`);
      assert.ok(feed.length <= 50, `${context(step)} 事件流超过上限`);
      for (let index = 1; index < feed.length; index += 1) {
        assert.ok(feed[index].seq > feed[index - 1].seq, `${context(step)} 事件序号必须递增且不重复`);
      }
    }
  }

  assert.equal(expectedCount, host.rec.last('snapshot').game.count, '结束时计数仍要对得上');
});
