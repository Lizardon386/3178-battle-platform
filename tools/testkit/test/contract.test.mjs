import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, createRoom } from '@bp/testkit/contract-harness';
import turnBasedFixture from '@bp/testkit/test-games/turn-based';
import simultaneousFixture from '@bp/testkit/test-games/simultaneous';

/**
 * 契约测试：同一份平台内核 + 两个形状完全不同的测试夹具。
 * 回合制夹具有回合游标和隐私状态，同时操作夹具两者都没有——
 * 如果内核里藏着任何玩法假设，这个套件会在其中一个夹具上红掉。
 */

const SPECS = [
  {
    name: '测试夹具·回合制（有回合游标 + 隐私）',
    module: turnBasedFixture,
    seatSlots: 3,
    config: { range: 6, target: 4, turnMs: 5000 },
    legal: (who, room) => ({ name: 'guess', payload: { targetSeatId: room.otherSeat(who), value: 3 } }),
    expectPrivacy(guestView, otherView) {
      assert.ok(guestView.mySecret, '本人要拿到自己的秘密');
      assert.equal(Object.prototype.hasOwnProperty.call(otherView, 'mySecret'), true);
      assert.notEqual(guestView.mySecret, otherView.mySecret, '两个玩家各自看到自己的秘密');
      assert.equal(otherView.scores.length, 2);
    },
    expectSpectatorPrivacy(spectatorView) {
      assert.equal(spectatorView.mySecret, null, '观战视角不许有秘密');
    },
    tickExpect: 'turnAdvanced',
  },
  {
    name: '测试夹具·同时操作（无游标 + 无隐私 + 同时操作）',
    module: simultaneousFixture,
    seatSlots: 3,
    config: { goal: 3, limitMs: 2000 },
    legal: () => ({ name: 'plus' }),
    expectPrivacy(guestView, otherView) {
      assert.equal(guestView.value, otherView.value, '协作游戏两端看到同一个数');
    },
    expectSpectatorPrivacy(spectatorView) {
      assert.equal(typeof spectatorView.value, 'number', '观战视角与玩家视角同形');
    },
    tickExpect: 'timeout',
  },
];

for (const spec of SPECS) {
  test(`${spec.name}：建房即房主，房号可加入`, () => {
    const h = harness(spec);
    const host = createRoom(h, spec);
    const granted = host.rec.last('seatGranted');
    assert.ok(granted, '房主要拿到 seatGranted');
    assert.equal(granted.role, 'host');
    assert.ok(granted.ticket.length >= 16, '票据必须够长，不能是序号');
    const snap = host.rec.last('snapshot');
    assert.equal(snap.phase, 'lobby');
    assert.equal(snap.game, null, '没开局前游戏状态为空');
    assert.equal(snap.room.rulesHash.length, 16);
    assert.deepEqual(snap.room.config, spec.module.normalizeConfig(spec.config), '房间视图要带规范化后的房规');

    const guest = h.join('客人');
    guest.send({ type: 'roomJoin', code: snap.room.code });
    const guestSnap = guest.rec.last('snapshot');
    assert.equal(guestSnap.seats.length, 2);
    assert.deepEqual(guestSnap.seats.map((s) => s.slot), [1, 2]);
    assert.deepEqual(guestSnap.room.config, snap.room.config, '加入者也要看到同一份房规');
  });

  test(`${spec.name}：Ready 闸——有人没准备就开不了局`, () => {
    const h = harness(spec);
    const host = createRoom(h, spec);
    const code = host.rec.last('snapshot').room.code;
    const guest = h.join('客人');
    guest.send({ type: 'roomJoin', code });
    guest.send({ type: 'hostStart' });
    assert.equal(guest.rec.last('error')?.code, 'NOTHOST', '非房主连开局请求都发不动');

    host.send({ type: 'hostStart' });
    const blocked = host.rec.last('error');
    assert.equal(blocked.code, 'PHASE');
    assert.match(blocked.message, /还没准备/);

    guest.send({ type: 'ready', ready: true });
    host.send({ type: 'hostStart' });
    const playing = host.rec.last('snapshot');
    assert.equal(playing.phase, 'playing');
    assert.ok(playing.game, '开局后游戏状态必须存在');
  });

  test(`${spec.name}：玩法动作经平台投递，平台不看内容`, () => {
    const h = harness(spec);
    const host = createRoom(h, spec);
    const code = host.rec.last('snapshot').room.code;
    const guest = h.join('客人');
    guest.send({ type: 'roomJoin', code });
    const seatIdOf = (who) => who.rec.last('seatGranted').seatId;
    const hostSeatId = seatIdOf(host);
    const guestSeatId = seatIdOf(guest);
    const otherSeat = (seatId) => (seatId === hostSeatId ? guestSeatId : hostSeatId);
    guest.send({ type: 'ready', ready: true });
    host.send({ type: 'hostStart' });

    const before = guest.rec.last('snapshot').revision;
    const room = { otherSeat };
    const legal = spec.legal(guestSeatId, room);
    // 回合制夹具有回合概念：不是它的回合会被游戏自己拒绝；同时操作夹具永远接受。
    const isTurn = guest.rec.last('snapshot').game?.current === guestSeatId;
    if (spec.module.id === 'fixture-turn' && !isTurn) {
      guest.send({ type: 'gameAction', name: legal.name, payload: legal.payload });
      const rejected = guest.rec.last('error');
      assert.equal(rejected.code, 'PHASE', '回合判断由游戏给出，平台只转发');
      guest.rec.clear();
      const hostLegal = spec.legal(hostSeatId, room);
      host.send({ type: 'gameAction', name: hostLegal.name, payload: hostLegal.payload });
      const newest = host.rec.last('snapshot').revision;
      const oldest = host.rec.of('snapshot')[0].revision;
      assert.ok(newest > oldest || host.rec.last('error'), '房主的动作要么推进状态，要么被游戏拒绝');
    } else {
      guest.send({ type: 'gameAction', name: legal.name, payload: legal.payload });
      assert.ok(guest.rec.last('snapshot').revision > before, '动作要推进状态');
      assert.equal(guest.rec.last('error'), undefined);
    }
  });

  test(`${spec.name}：视角裁剪由游戏负责，观战拿不到隐私`, () => {
    const h = harness(spec);
    const host = createRoom(h, spec);
    const code = host.rec.last('snapshot').room.code;
    const guest = h.join('客人');
    guest.send({ type: 'roomJoin', code });
    guest.send({ type: 'ready', ready: true });
    host.send({ type: 'hostStart' });
    const spectator = h.join('看客');
    spectator.send({ type: 'roomJoin', code, as: 'spectator' });

    const hostView = host.rec.last('snapshot').game;
    const guestView = guest.rec.last('snapshot').game;
    spec.expectPrivacy(hostView, guestView);
    spec.expectSpectatorPrivacy(spectator.rec.last('snapshot').game);
    assert.equal(spectator.rec.last('snapshot').seats.filter((s) => s.role === 'spectator').length, 1);
  });

  test(`${spec.name}：票据重连；错票据与假座位都拿不到席位`, () => {
    const h = harness(spec);
    const host = createRoom(h, spec);
    const code = host.rec.last('snapshot').room.code;
    const guest = h.join('客人');
    guest.send({ type: 'roomJoin', code });
    const granted = guest.rec.last('seatGranted');

    guest.rec.clear();
    const ghost = h.join('冒名者');
    const stolen = ghost.send({ type: 'seatResume', code, seatId: granted.seatId, ticket: '胡说八道' });
    assert.equal(stolen.flatMap((o) => [o.message]).find((m) => m.type === 'error')?.code, 'NOSEAT');
    const fake = ghost.send({ type: 'seatResume', code, seatId: 's00000000', ticket: granted.ticket });
    assert.equal(fake.flatMap((o) => [o.message]).find((m) => m.type === 'error')?.code, 'NOSEAT');

    const back = h.join('客人重开');
    back.send({ type: 'seatResume', code, seatId: granted.seatId, ticket: granted.ticket });
    assert.ok(back.rec.last('snapshot'), '带对票据能回到同一个座位');
    assert.equal(back.rec.last('seatGranted').seatId, granted.seatId);
  });

  test(`${spec.name}：房主离席被挡，移交后旧房主报 HOSTONLY`, () => {
    const h = harness(spec);
    const host = createRoom(h, spec);
    const code = host.rec.last('snapshot').room.code;
    const guest = h.join('客人');
    guest.send({ type: 'roomJoin', code });

    host.send({ type: 'seatLeave' });
    assert.match(host.rec.last('error').message, /移交房主或关闭房间/);

    const guestSeatId = guest.rec.last('seatGranted').seatId;
    host.send({ type: 'hostTransfer', seatId: guestSeatId });
    assert.equal(guest.rec.last('snapshot').room.hostSeatId, guestSeatId);
    host.send({ type: 'hostStart' });
    assert.equal(host.rec.last('error').code, 'HOSTONLY');
    guest.send({ type: 'ready', ready: true });
    host.send({ type: 'ready', ready: true });
    guest.send({ type: 'hostStart' });
    assert.equal(guest.rec.last('snapshot').phase, 'playing', '新房主可以开局');
  });

  test(`${spec.name}：房主踢人、玩家聊天、房间关闭`, () => {
    const h = harness(spec);
    const host = createRoom(h, spec);
    const code = host.rec.last('snapshot').room.code;
    const guest = h.join('客人');
    guest.send({ type: 'roomJoin', code });
    const spectator = h.join('看客');
    spectator.send({ type: 'roomJoin', code, as: 'spectator' });

    guest.send({ type: 'chat', text: '来了' });
    assert.equal(host.rec.last('chat').text, '来了');
    assert.equal(host.rec.last('chat').name, '客人');

    const spectatorSeatId = spectator.rec.last('seatGranted').seatId;
    host.send({ type: 'hostKick', seatId: spectatorSeatId });
    assert.equal(spectator.rec.closedCode, 1008);
    assert.equal(host.rec.last('snapshot').seats.length, 2);

    guest.send({ type: 'seatLeave' });
    assert.equal(host.rec.last('snapshot').seats.filter((s) => s.role === 'spectator').length, 0);

    host.send({ type: 'hostClose', reason: '吃饭去' });
    assert.equal(host.rec.last('notice').code, 'ROOM_CLOSED');
    assert.equal(h.engine.registry.size(), 0);
  });

  test(`${spec.name}：心跳推进游戏自己的时间语义`, () => {
    const h = harness(spec);
    const host = createRoom(h, spec);
    const code = host.rec.last('snapshot').room.code;
    const guest = h.join('客人');
    guest.send({ type: 'roomJoin', code });
    guest.send({ type: 'ready', ready: true });
    host.send({ type: 'hostStart' });
    host.rec.clear();
    guest.rec.clear();

    h.step((spec.config.turnMs ?? spec.config.limitMs) + 10);
    if (spec.tickExpect === 'timeout') {
      assert.ok(guest.rec.of('event').some((e) => e.name === 'gameOver'), '协作游戏超时要有结束事件');
      assert.equal(guest.rec.last('snapshot').phase, 'ended');
    } else {
      assert.ok(host.rec.of('event').some((e) => e.name === 'timeout') || guest.rec.of('event').some((e) => e.name === 'timeout'), '回合游戏超时要轮转');
      assert.equal(guest.rec.last('snapshot').phase, 'playing', '单人超时不该终止整局');
    }
  });

  test(`${spec.name}：限流挡住刷屏`, () => {
    const limited = harness({ ...spec, ratePerSec: 1, burst: 2 });
    const host = createRoom(limited, spec);
    host.rec.clear();
    for (let i = 0; i < 6; i += 1) host.send({ type: 'ping', nonce: `n${i}` });
    assert.ok(host.rec.of('error').some((e) => e.code === 'RATE'), '超限要报错');
  });
}

test('版本闸：房规不符或游戏版本不符都进不了房（war3 的地图校验位）', () => {
  const spec = SPECS[0];
  const h = harness(spec);
  const host = createRoom(h, spec);
  const room = host.rec.last('snapshot').room;

  const wrongRules = h.join('改了房规', { rulesHash: 'ffffffffffffffff' });
  wrongRules.send({ type: 'roomJoin', code: room.code });
  assert.equal(wrongRules.rec.last('error').code, 'RULES', '房规不同要挡在门外');

  const wrongVersion = h.join('旧客户端', { version: '0.0.9', rulesHash: room.rulesHash });
  wrongVersion.send({ type: 'roomJoin', code: room.code });
  assert.equal(wrongVersion.rec.last('error').code, 'VERSION', '版本不同要提示更新，而不是开局后炸');

  const matching = h.join('同版本', { version: spec.module.version, rulesHash: room.rulesHash });
  matching.send({ type: 'roomJoin', code: room.code });
  assert.ok(matching.rec.last('seatGranted'), '房规与版本都一致才放行');
});

test('房主进程退出：广播主机已退出并删局', () => {
  const spec = SPECS[1];
  const h = harness(spec);
  const host = createRoom(h, spec);
  const code = host.rec.last('snapshot').room.code;
  const guest = h.join('客人');
  guest.send({ type: 'roomJoin', code });
  guest.send({ type: 'ready', ready: true });
  host.send({ type: 'hostStart' });
  host.rec.clear();
  guest.rec.clear();
  h.engine.shutdown();
  assert.equal(guest.rec.last('notice').code, 'HOSTLEFT');
  assert.equal(h.engine.registry.size(), 0);
});

test('seatGranted 的 manifest 也带 ruleConfig / reference', () => {
  const module = {
    ...turnBasedFixture,
    ruleConfig: { fields: [{ key: 'rounds', label: '回合数', type: 'integer', default: 8, min: 1, max: 20 }] },
    reference: { entry: 'docs/reference.json' },
  };
  const h = harness({ module, config: {} });
  const host = createRoom(h, { module, seatSlots: 2, config: {} });
  const granted = host.rec.last('seatGranted');
  assert.deepEqual(granted.manifest.ruleConfig, module.ruleConfig);
  assert.deepEqual(granted.manifest.reference, module.reference);
});

test('房主改规则：规则/哈希变化、真人准备重置、非房主被拒、后加入者看到新值', () => {
  const module = {
    ...turnBasedFixture,
    ruleConfig: { fields: [{ key: 'range', label: '数值范围', type: 'integer', default: 6, min: 4, max: 99 }] },
  };
  const h = harness({ module, config: { range: 6, target: 4, turnMs: 5000 } });
  const host = createRoom(h, { module, config: { range: 6, target: 4, turnMs: 5000 } });
  const code = host.rec.last('snapshot').room.code;
  const guest = h.join('客人');
  guest.send({ type: 'roomJoin', code });
  guest.send({ type: 'ready', ready: true });
  assert.equal(guest.rec.last('snapshot').seats.find((s) => s.name === '客人').ready, true);

  guest.send({ type: 'ruleConfig', config: { range: 8 } });
  assert.equal(guest.rec.last('error').code, 'HOSTONLY', '非房主不能改规则');

  const before = host.rec.last('snapshot');
  host.send({ type: 'ruleConfig', config: { range: 8 } });
  const after = host.rec.last('snapshot');
  assert.equal(after.room.config.range, 8);
  assert.notEqual(after.room.rulesHash, before.room.rulesHash);
  assert.equal(after.seats.find((s) => s.name === '客人').ready, false, '改规则要重置真人准备');
  assert.ok(host.rec.last('chat').text.includes('房规已更新，请重新准备'));

  host.send({ type: 'hostStart' });
  assert.equal(host.rec.last('error').code, 'PHASE', '未重新准备不能开局');
  guest.send({ type: 'ready', ready: true });

  const late = h.join('后来的人');
  late.send({ type: 'roomJoin', code });
  const lateGranted = late.rec.last('seatGranted');
  assert.deepEqual(lateGranted.manifest.ruleConfig, module.ruleConfig);
  assert.equal(late.rec.last('snapshot').room.config.range, 8, '后加入者看到改后的规则');
  late.send({ type: 'ready', ready: true });
  host.send({ type: 'hostStart' });
  assert.equal(host.rec.last('snapshot').phase, 'playing');
  host.send({ type: 'ruleConfig', config: { range: 9 } });
  assert.equal(host.rec.last('error').code, 'PHASE', '对局开始后规则只读');
});

test('座位级选项：房主 setOptions 广播，非房主与 playing 被拒', () => {
  const module = {
    ...turnBasedFixture,
    seatOptions: {
      fields: [{ key: 'color', label: '颜色', type: 'enum', roles: ['host', 'player', 'ai'], default: 'red', options: [{ value: 'red', label: '红' }, { value: 'blue', label: '蓝' }] }],
    },
    normalizeSeatOptions: (role, slot, raw) => ({ color: raw?.color === 'blue' ? 'blue' : 'red' }),
  };
  const h = harness({ module, config: {} });
  const host = createRoom(h, { module, seatSlots: 3, config: {} });
  const code = host.rec.last('snapshot').room.code;
  const guest = h.join('选项客人');
  guest.send({ type: 'roomJoin', code });
  const guestSeat = guest.rec.last('seatGranted');
  host.send({ type: 'hostSeat', op: 'setOptions', seatId: guestSeat.seatId, options: { color: 'blue' } });
  const snap = host.rec.last('snapshot');
  assert.equal(snap.seats.find((s) => s.seatId === guestSeat.seatId).options.color, 'blue');
  guest.send({ type: 'hostSeat', op: 'setOptions', seatId: guestSeat.seatId, options: { color: 'red' } });
  assert.equal(guest.rec.last('error').code, 'NOTHOST');
  guest.send({ type: 'ready', ready: true });
  host.send({ type: 'hostStart' });
  host.send({ type: 'hostSeat', op: 'setOptions', seatId: guestSeat.seatId, options: { color: 'red' } });
  assert.equal(host.rec.last('error').code, 'PHASE');
});
