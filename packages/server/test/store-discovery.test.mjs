import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine, HostStore, STORE_VERSION, decodeBeacon, encodeBeacon, LanBrowser } from '@bp/server';
import echoModule from '@bp/game-echo';

/** 房主侧落盘与局域网发现信标的测试：都不需要真网卡，也不需要真进程重启。 */

function storeDir() {
  return mkdtempSync(join(tmpdir(), 'bp-store-'));
}

function makeEngine() {
  let now = 100_000;
  const engine = new Engine({ modules: [echoModule], now: () => now, random: () => 0.4 });
  return { engine, now: () => now };
}

function playOneRound(engine) {
  const hostTransport = { sent: [], send(raw) { this.sent.push(JSON.parse(raw)); }, close() {} };
  const guestTransport = { sent: [], send(raw) { this.sent.push(JSON.parse(raw)); }, close() {} };
  const hostId = engine.openConn(hostTransport);
  engine.publish(engine.dispatch(hostId, { type: 'hello', protocol: 1, nick: '房主', gameId: 'echo', version: echoModule.version }));
  engine.publish(engine.dispatch(hostId, {
    type: 'roomCreate',
    gameId: 'echo',
    roomName: '落盘测试',
    seatSlots: 3,
    config: { range: 9, target: 3, turnMs: 20000 },
  }));
  const code = hostTransport.sent.at(-1).room.code;
  const guestId = engine.openConn(guestTransport);
  engine.publish(engine.dispatch(guestId, { type: 'hello', protocol: 1, nick: '客人', gameId: 'echo', version: echoModule.version }));
  engine.publish(engine.dispatch(guestId, { type: 'roomJoin', code }));
  const granted = guestTransport.sent.find((m) => m.type === 'seatGranted');
  engine.publish(engine.dispatch(guestId, { type: 'ready', ready: true }));
  engine.publish(engine.dispatch(hostId, { type: 'hostStart' }));
  return { code, hostTransport, guestTransport, granted, hostId };
}

function entryOf(dir, code) {
  return JSON.parse(readFileSync(join(dir, `room-${code}.json`), 'utf8'));
}

test('房主侧落盘 → 重启恢复：房号、座位、票据、对局状态都回来了', () => {
  const dir = storeDir();
  const a = makeEngine();
  const round = playOneRound(a.engine);
  assert.equal(round.hostTransport.sent.at(-1).phase, 'playing');

  const store = new HostStore(dir);
  assert.equal(a.engine.syncStore(store).saved, 1);
  assert.ok(existsSync(join(dir, `room-${round.code}.json`)));

  const b = makeEngine();
  const report = b.engine.restoreFrom(new HostStore(dir).readAll().entries);
  assert.deepEqual(report.restored, [round.code]);
  assert.deepEqual(report.dropped, []);
  const room = b.engine.registry.get(round.code);
  assert.equal(room.phase, 'playing');
  assert.equal(room.seats.length, 2);
  assert.ok(room.game, '对局状态由游戏模块自己 resume，平台不认识它');
  assert.equal(room.seats.every((s) => !s.connected), true, '恢复回来的座位是待重连状态');

  const back = { sent: [], send(raw) { this.sent.push(JSON.parse(raw)); }, close() {} };
  const backId = b.engine.openConn(back);
  b.engine.publish(b.engine.dispatch(backId, { type: 'hello', protocol: 1, nick: '客人重开', gameId: 'echo', version: echoModule.version }));
  b.engine.publish(b.engine.dispatch(backId, {
    type: 'seatResume',
    code: round.code,
    seatId: round.granted.seatId,
    ticket: round.granted.ticket,
  }));
  assert.ok(room.seat(round.granted.seatId).connected, '旧票据在重启后仍能回到同一个座位');
  assert.equal(back.sent.at(-1).type, 'snapshot');
  assert.equal(back.sent.at(-1).game.kind, 'echo');
});

test('明文票据不落盘，落的是摘要', () => {
  const dir = storeDir();
  const a = makeEngine();
  const round = playOneRound(a.engine);
  const store = new HostStore(dir);
  a.engine.syncStore(store);
  const raw = JSON.stringify(entryOf(dir, round.code));
  assert.equal(entryOf(dir, round.code).v, STORE_VERSION);
  assert.ok(!raw.includes(round.granted.ticket), '拿到快照文件不等于能占座');
  assert.ok(raw.includes('secretHash'), '座位摘要要能重建');
});

test('房规被改过的快照直接丢弃，不硬开一局不一样的', () => {
  const dir = storeDir();
  const a = makeEngine();
  const round = playOneRound(a.engine);
  const store = new HostStore(dir);
  a.engine.syncStore(store);
  const entry = entryOf(dir, round.code);
  entry.config.target = 99;
  store.writeFile(round.code, JSON.stringify(entry));

  const b = makeEngine();
  const report = b.engine.restoreFrom(new HostStore(dir).readAll().entries);
  assert.deepEqual(report.restored, []);
  assert.equal(report.dropped[0].reason, 'RULES');
});

test('游戏版本变了就丢快照（旧项目牌堆版本闸的泛化）', () => {
  const dir = storeDir();
  const a = makeEngine();
  const round = playOneRound(a.engine);
  const store = new HostStore(dir);
  a.engine.syncStore(store);
  const entry = entryOf(dir, round.code);
  entry.gameVersion = '9.9.9';
  store.writeFile(round.code, JSON.stringify(entry));

  const b = makeEngine();
  const report = b.engine.restoreFrom(new HostStore(dir).readAll().entries);
  assert.equal(report.dropped[0].reason, 'VERSION');
});

test('坏文件与半个 .tmp 都不许挡住启动', () => {
  const dir = storeDir();
  writeFileSync(join(dir, 'room-BAD1.json'), '{不是 JSON', 'utf8');
  writeFileSync(join(dir, 'room-BAD2.json'), JSON.stringify({ v: 999, room: { code: 'BAD2' } }), 'utf8');
  writeFileSync(join(dir, 'room-GOOD.json.tmp'), '{"half', 'utf8');
  const store = new HostStore(dir);
  const { entries, broken } = store.readAll();
  assert.equal(entries.length, 0);
  assert.deepEqual(broken.sort(), ['BAD1', 'BAD2']);
  assert.equal(store.purgeOrphans(), 1);
  assert.equal(readdirSync(dir).filter((n) => n.endsWith('.tmp')).length, 0);
});

test('房号来自文件名时也要卡死字符集，别让路径穿越进写盘', () => {
  const dir = storeDir();
  const store = new HostStore(dir);
  assert.equal(store.writeFile('../../evil', '{}'), false);
  assert.equal(store.writeFile('room-x', '{}'), false);
  assert.equal(store.writeFile('AB3D', '{}'), true);
  assert.ok(existsSync(join(dir, 'room-AB3D.json')));
});

test('关掉的房不会在下次启动时复活', () => {
  const dir = storeDir();
  const a = makeEngine();
  const round = playOneRound(a.engine);
  const store = new HostStore(dir);
  a.engine.syncStore(store);
  a.engine.publish(a.engine.dispatch(round.hostId, { type: 'hostClose', reason: '睡觉' }));
  const synced = a.engine.syncStore(store);
  assert.deepEqual(synced.removed, [round.code]);
  assert.equal(store.readAll().entries.length, 0);
});

const beaconRoom = (over = {}) => ({
  code: 'AB3D',
  name: '公开房',
  gameId: 'echo',
  gameName: '数字回声',
  phase: 'lobby',
  occupied: 2,
  seatSlots: 4,
  hostName: '房主',
  lanUrl: 'ws://192.168.1.20:3000/ws',
  ttl: 8,
  hidden: false,
  ...over,
});

test('组播信标：隐藏房不上广播，坏包解码成 null', () => {
  const decoded = decodeBeacon(encodeBeacon([beaconRoom(), beaconRoom({ code: 'HID1', hidden: true })], 1_000));
  assert.equal(decoded.rooms.length, 1);
  assert.equal(decoded.rooms[0].code, 'AB3D');
  assert.equal(decodeBeacon(Buffer.from('不是 JSON')), null);
  assert.equal(decodeBeacon(Buffer.from('{"v":2,"rooms":[]}')), null);
});

test('长房名在信标里被截断，广播包不会涨到分片', () => {
  const decoded = decodeBeacon(encodeBeacon([beaconRoom({ name: '房'.repeat(120), hostName: '甲'.repeat(80) })], 1));
  assert.ok(decoded.rooms[0].name.length <= 40);
  assert.ok(decoded.rooms[0].hostName.length <= 24);
});

test('浏览端的过期表按注入时钟剔除', () => {
  let now = 1_000;
  const browser = new LanBrowser({ now: () => now, entryTtlMs: 8_000 });
  browser.absorb(decodeBeacon(encodeBeacon([beaconRoom()], now)));
  assert.equal(browser.list().length, 1);
  now += 9_000;
  assert.equal(browser.list().length, 0, '超过 TTL 没再收到信标就当房主退了');
  now += 1;
  assert.equal(browser.list().length, 0);
});

test('票据离开进程前，座位必须已经在盘上（挂 onTicketIssued，不手动同步）', () => {
  // 只靠 250ms 轮询的话，"刚加入不到一个周期就被硬杀"会让恢复后的房里没有这个座位，
  // 玩家拿真票据重连只能得到 NOSEAT（房还在、座位没了）。这条钉住那一次写盘是必须的。
  const dir = storeDir();
  const store = new HostStore(dir);
  const engine = new Engine({ modules: [echoModule], onTicketIssued: () => engine.syncStore(store) });
  const hostT = { sent: [], send(raw) { this.sent.push(JSON.parse(raw)); }, close() {} };
  const guestT = { sent: [], send(raw) { this.sent.push(JSON.parse(raw)); }, close() {} };
  const hostId = engine.openConn(hostT);
  engine.publish(engine.dispatch(hostId, { type: 'hello', protocol: 1, nick: '房主', gameId: 'echo', version: echoModule.version }));
  engine.publish(engine.dispatch(hostId, { type: 'roomCreate', gameId: 'echo', roomName: '票据前落盘', seatSlots: 2, config: {} }));
  const code = hostT.sent.map((m) => m.code).find(Boolean);
  assert.ok(existsSync(join(dir, `room-${code}.json`)), '房主拿到票据时，房里就该已经有它的座位文件');

  const guestId = engine.openConn(guestT);
  engine.publish(engine.dispatch(guestId, { type: 'hello', protocol: 1, nick: '客人', gameId: 'echo', version: echoModule.version }));
  engine.publish(engine.dispatch(guestId, { type: 'roomJoin', code }));
  const granted = guestT.sent.find((m) => m.type === 'seatGranted');
  assert.ok(granted, '客人没坐上');
  const onDisk = JSON.parse(readFileSync(join(dir, `room-${code}.json`), 'utf8'));
  const seat = onDisk.room.seats.find((s) => s.seatId === granted.seatId);
  assert.ok(seat, '客人拿到了票据，但盘上的房里没有他这个座位——重连必然 NOSEAT');
  assert.ok(typeof seat.secretHash === 'string' && seat.secretHash.length > 8, '座位要带着票据摘要，重启后才验得回');
});

test('落盘跳过没变的房：所以同步可以跟着心跳勤调，而不把磁盘写爆', () => {
  const dir = storeDir();
  const { engine } = makeEngine();
  const transport = { sent: [], send(raw) { this.sent.push(JSON.parse(raw)); }, close() {} };
  const id = engine.openConn(transport);
  engine.publish(engine.dispatch(id, { type: 'hello', protocol: 1, nick: '房主', gameId: 'echo', version: echoModule.version }));
  engine.publish(engine.dispatch(id, { type: 'roomCreate', gameId: 'echo', roomName: '勤同步', seatSlots: 2, config: {} }));
  const store = new HostStore(dir);

  assert.equal(engine.syncStore(store).saved, 1, '新建的房要当场落盘，别等下一个周期');
  assert.equal(engine.syncStore(store).saved, 0, '内容没变就不该再写一次');
  assert.equal(engine.syncStore(store).saved, 0, '连着调也不写——这是把间隔从 2 秒压到 250ms 的前提');

  engine.publish(engine.dispatch(id, { type: 'hostSeat', op: 'addAi' }));
  assert.equal(engine.syncStore(store).saved, 1, '座位一变就要落，否则硬杀后朋友的邀请链接进不来');
  assert.equal(engine.syncStore(store).saved, 0, '落过之后 again 不重复写');
});
