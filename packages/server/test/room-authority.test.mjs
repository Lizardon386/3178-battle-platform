import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stableDigest } from '@lizardon386/core-abi';
import { RoomRegistry, requireHost, requireSeat, requireTicket, canBegin, canJoinAs } from '@bp/server';

function makeInstance(ctx) {
  return {
    serialize: () => ({ kind: 'fake', seats: ctx.seats().length }),
    handle: () => [{ kind: 'broadcast', name: 'pinged' }],
    begin: () => [{ kind: 'broadcast', name: 'go' }],
    snapshot: () => ({ ok: true }),
  };
}

function fakeModule(over = {}) {
  return {
    id: 'fake',
    name: '假游戏',
    version: '0.0.1',
    entry: 'client.js',
    seats: { min: 2, max: 4 },
    allowSpectate: true,
    soloFill: true,
    roles: ['host', 'player', 'spectator', 'ai'],
    normalizeConfig: (raw) => ({ speed: raw?.speed ?? 1 }),
    rulesHashOf: (config) => stableDigest(config),
    create: (_config, ctx) => makeInstance(ctx),
    resume: (_snap, ctx) => makeInstance(ctx),
    ...over,
  };
}

function roomWith(opts = {}) {
  let now = opts.now ?? 1_000;
  const registry = new RoomRegistry(() => now);
  const room = registry.create({
    name: opts.name ?? '测试房',
    module: opts.module ?? fakeModule(),
    rawConfig: opts.rawConfig,
    seatSlots: opts.seatSlots ?? 4,
    password: opts.password ?? null,
    hidden: opts.hidden ?? false,
    allowSpectate: opts.allowSpectate ?? true,
  });
  const host = room.addSeat({ name: '房主', role: 'host' });
  return { room, registry, now: () => now, setNow: (v) => (now = v), host: host.seat, ticket: host.ticket };
}

test('建房者即房主，占 1 号槽', () => {
  const { room, host } = roomWith();
  assert.equal(room.hostSeatId, host.seatId);
  assert.equal(host.slot, 1);
  assert.equal(host.role, 'host');
  assert.ok(requireHost(room, host.seatId).ok);
});

test('RoomView 带规范化后的 config，且不把内部对象直接交出去', () => {
  const { room } = roomWith({ rawConfig: { speed: 3 } });
  const view = room.roomView();
  assert.deepEqual(view.config, { speed: 3 });
  view.config.speed = 9;
  assert.equal(room.roomView().config.speed, 3);
});

test('非房主不能开局/踢人/关房（旧项目谁发 start 都能开局）', () => {
  const { room, host } = roomWith();
  const guest = room.addSeat({ name: '客人', role: 'player' });
  assert.ok(guest.ok);
  const denied = requireHost(room, guest.seat.seatId);
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.code, 'NOTHOST');
    assert.match(denied.message, /只有房主/);
  }
  assert.ok(requireHost(room, host.seatId).ok);
});

test('房主权限移交给 B 之后：A 报"你不再是房主"，B 正常', () => {
  const { room } = roomWith();
  const b = room.addSeat({ name: '小B', role: 'player' });
  room.setHost(b.seat.seatId);
  const a = room.seats.find((s) => s.name === '房主');
  assert.equal(a.role, 'player', '移交后旧房主降为普通玩家');
  assert.equal(room.hostSeatId, b.seat.seatId);
  const after = requireHost(room, a.seatId);
  assert.equal(after.ok, false);
  if (!after.ok) {
    assert.equal(after.code, 'HOSTONLY');
    assert.match(after.message, /已移交/);
  }
  assert.ok(requireHost(room, b.seat.seatId).ok);
});

test('开局闸：房主与 AI 不算未准备，普通玩家没 Ready 就开不了', () => {
  const { room } = roomWith();
  const guest = room.addSeat({ name: '客人', role: 'player' });
  room.addSeat({ name: '电脑', role: 'ai', isAi: true });
  const blocked = canBegin(room);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.message, /还没准备：客人/);
  room.seat(guest.seat.seatId).ready = true;
  assert.ok(canBegin(room).ok);
});

test('人数不足游戏下限时不开局', () => {
  const { room } = roomWith({ seatSlots: 4 });
  const only = canBegin(room);
  assert.equal(only.ok, false);
  if (!only.ok) assert.match(only.message, /至少 2 人/);
});

test('票据：丢了票据就不能占座，且报错不泄露座位是否存在', () => {
  const { room } = roomWith();
  const guest = room.addSeat({ name: '客人', role: 'player' });
  assert.ok(room.verifyTicket(guest.seat.seatId, guest.ticket));
  const wrong = requireTicket(room, guest.seat.seatId, '胡说八道');
  assert.equal(wrong.ok, false);
  const ghost = requireTicket(room, 's00000000', guest.ticket);
  assert.equal(ghost.ok, false);
  if (!wrong.ok && !ghost.ok) assert.equal(wrong.code, ghost.code, '两种失败的码必须一致，否则可枚举座位');
});

test('重连守卫：旧 socket 关闭不能把已重连的座位踢下线', () => {
  const { room } = roomWith();
  const oldSocket = { send() {}, close() {} };
  const newSocket = { send() {}, close() {} };
  const guest = room.addSeat({ name: '客人', role: 'player', transport: oldSocket });
  room.detach(guest.seat.seatId, oldSocket);
  room.attach(guest.seat.seatId, newSocket);
  const stale = room.detach(guest.seat.seatId, oldSocket);
  assert.equal(stale, false);
  assert.equal(room.seat(guest.seat.seatId).connected, true);
});

test('满员按玩家槽算，观战不占座', () => {
  const { room } = roomWith({ seatSlots: 2 });
  room.addSeat({ name: 'A', role: 'player' });
  assert.equal(room.occupied(), 2, '房主自己占一个玩家槽');
  const third = room.addSeat({ name: 'C', role: 'player' });
  assert.equal(third.ok, false);
  const full = canJoinAs(room, 'player', undefined);
  assert.equal(full.ok, false);
  if (!full.ok) assert.equal(full.code, 'FULL');
  const spectate = room.addSeat({ name: '看客', role: 'spectator' });
  assert.ok(spectate.ok);
  assert.equal(room.occupied(), 2);
  assert.equal(room.spectators(), 1);
});

test('关房主自己关观战时，观战请求被拒', () => {
  const { room } = roomWith({ allowSpectate: false });
  const denied = canJoinAs(room, 'spectator', undefined);
  assert.equal(denied.ok, false);
});

test('密码房：密码不对进不去', () => {
  const { room } = roomWith({ password: '1234' });
  assert.equal(room.checkPassword('1234'), true);
  assert.equal(room.checkPassword('1235'), false);
  assert.equal(room.checkPassword(undefined), false);
  assert.equal(room.roomView().hasPassword, true);
});

test('游戏不支持 AI 填充时，房主加电脑位被拒', () => {
  const { room } = roomWith({ module: fakeModule({ soloFill: false }) });
  const ai = room.addSeat({ name: '电脑', role: 'ai', isAi: true });
  assert.equal(ai.ok, false);
});

test('对局已开始后加入只能观战', () => {
  const { room } = roomWith();
  room.phase = 'playing';
  const late = canJoinAs(room, 'player', undefined);
  assert.equal(late.ok, false);
  if (!late.ok) assert.match(late.message, /观战/);
});

test('座位视图按槽位排序，房主标记冗余但一致', () => {
  const { room } = roomWith();
  room.addSeat({ name: 'B', role: 'player' });
  room.addSeat({ name: 'C', role: 'player' });
  const views = room.seatsView();
  assert.deepEqual(views.map((v) => v.slot), [1, 2, 3]);
  assert.deepEqual(views.map((v) => v.isHost), [true, false, false]);
  assert.equal(requireSeat(room, views[2].seatId).ok, true);
});

test('规则摘要随房规变，不随房间名变', () => {
  const slow = roomWith({ rawConfig: { speed: 1 }, name: '甲房' });
  const fast = roomWith({ rawConfig: { speed: 2 }, name: '甲房' });
  assert.notEqual(slow.room.rulesHash, fast.room.rulesHash);
  const renamed = roomWith({ rawConfig: { speed: 1 }, name: '乙房' });
  assert.equal(slow.room.rulesHash, renamed.room.rulesHash);
});
