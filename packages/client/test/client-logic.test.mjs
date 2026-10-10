import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHostAddress, parseInviteLink, wouldBeBlocked } from '@bp/client/endpoint.js';
import { ServerClock } from '@bp/client/clock.js';
import { AddressBook, NickName, SessionVault } from '@bp/client/local-store.js';
import {
  emptyViewModel,
  reduce,
  isHost,
  mySeat,
  startBlockers,
  emptySlots,
  seatLabel,
  inviteLink,
} from '@bp/client/view-model.js';
import { PlatformConnection } from '@bp/client/connection.js';

/** 客户端里"不碰 DOM 也能错"的那几块：地址解析、时钟、地址簿、视图归约、退避重连。 */

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

test('房主地址：接受裸 ip:端口，也接受完整网址，产出 ws 与 http 两个用途', () => {
  const bare = parseHostAddress('192.168.1.20:3000');
  assert.ok(bare.ok);
  if (bare.ok) {
    assert.equal(bare.endpoint.wsUrl, 'ws://192.168.1.20:3000/ws');
    assert.equal(bare.endpoint.httpOrigin, 'http://192.168.1.20:3000');
    assert.equal(bare.endpoint.secure, false);
  }
  const tunnel = parseHostAddress('https://abc-123.trycloudflare.com/');
  assert.ok(tunnel.ok);
  if (tunnel.ok) {
    assert.equal(tunnel.endpoint.wsUrl, 'wss://abc-123.trycloudflare.com/ws');
    assert.equal(tunnel.endpoint.secure, true);
  }
  const wsForm = parseHostAddress('ws://10.0.0.5:4000/ws');
  assert.ok(wsForm.ok);
  if (wsForm.ok) assert.equal(wsForm.endpoint.httpOrigin, 'http://10.0.0.5:4000');
});

test('地址输入错误的提示要能用中文说清下一步', () => {
  assert.equal(parseHostAddress('').code, 'EMPTY');
  assert.equal(parseHostAddress('ftp://x').code, 'BAD_SCHEME');
  assert.equal(parseHostAddress('http://').code, 'BAD_HOST');
});

test('邀请链接：h 缺省时用自己的来源，房号大写', () => {
  const parsed = parseInviteLink('http://192.168.1.20:3000/?r=ab3d&g=echo');
  assert.equal(parsed.code, 'AB3D');
  assert.equal(parsed.gameId, 'echo');
  assert.equal(parsed.endpoint?.wsUrl, 'ws://192.168.1.20:3000/ws');

  const relay = parseInviteLink('https://share.example/?h=192.168.1.20:3000&r=K7QT&g=turncount');
  assert.equal(relay.endpoint?.wsUrl, 'ws://192.168.1.20:3000/ws');
  assert.equal(relay.code, 'K7QT');

  const bad = parseInviteLink('不是 URL');
  assert.equal(bad.endpoint, null);
});

test('混合内容：https 页面连明文 ws 会被浏览器拦，要提前提示', () => {
  const plain = parseHostAddress('192.168.1.20:3000');
  assert.ok(plain.ok);
  if (plain.ok) {
    assert.equal(wouldBeBlocked('https:', plain.endpoint), true);
    assert.equal(wouldBeBlocked('http:', plain.endpoint), false);
  }
});

test('服务端时钟：serverNow + 单调钟外推，pong 用半个 RTT 补偿', () => {
  let mono = 1_000;
  const clock = new ServerClock({ monotonic: () => mono });
  clock.sync(50_000);
  mono += 250;
  assert.equal(clock.now(), 50_250);

  clock.markPingSent();
  mono += 100;
  clock.onPong(60_000);
  // 100ms 的往返 → 认为服务端现在是 60_000 + 50
  assert.equal(clock.now(), 60_050);
  mono += 10;
  assert.equal(clock.now(), 60_060);
});

test('地址簿：按最近使用排序、次数累加、能忘掉', () => {
  const storage = fakeStorage();
  const book = new AddressBook(storage);
  book.touch('http://a:3000', '老张的房', 'AB3D', 1_000);
  book.touch('http://b:3000', '小李的房', null, 2_000);
  book.touch('http://a:3000', '老张的房', 'K7QT', 3_000);
  const list = book.list();
  assert.equal(list[0].origin, 'http://a:3000');
  assert.equal(list[0].times, 2);
  assert.equal(list[0].lastCode, 'K7QT', '没给房号时保留上次的，给了就更新');
  book.forget('http://a:3000');
  assert.equal(book.list().length, 1);
});

test('地址簿坏数据与昵称截断都不许炸', () => {
  const storage = fakeStorage();
  storage.setItem('bp.addressbook.v1', '{坏 JSON');
  assert.deepEqual(new AddressBook(storage).list(), []);
  const nick = new NickName(storage);
  nick.set('很'.repeat(50));
  assert.equal(nick.get().length, 32);
});

test('票据按房主+房号隔离，换个房不会串座位', () => {
  const storage = fakeStorage();
  const vault = new SessionVault(storage);
  vault.save('http://a:3000', { roomCode: 'AB3D', seatId: 's1', ticket: 't1', gameId: 'echo' }, 1);
  vault.save('http://a:3000', { roomCode: 'ZZ99', seatId: 's2', ticket: 't2', gameId: 'echo' }, 2);
  assert.equal(vault.load('http://a:3000', 'AB3D').seatId, 's1');
  assert.equal(vault.load('http://a:3000', 'ZZ99').seatId, 's2');
  assert.equal(vault.load('http://b:3000', 'AB3D'), null);
  vault.clear('http://a:3000', 'AB3D');
  assert.equal(vault.load('http://a:3000', 'AB3D'), null);
});

const seat = (over = {}) => ({
  seatId: 's1',
  slot: 1,
  name: '甲',
  role: 'player',
  ready: false,
  connected: true,
  ageMs: 0,
  team: null,
  isHost: false,
  ...over,
});

test('视图归约：重复或乱序的快照被丢掉', () => {
  let view = emptyViewModel();
  const snap = (revision, phase = 'lobby') => ({
    type: 'snapshot',
    revision,
    serverNow: 1000 + revision,
    phase,
    room: { code: 'AB3D', name: '房', gameId: 'echo', gameName: '数字回声', hostSeatId: 's1', hostName: '甲', seatSlots: 4, occupied: 1, allowSpectate: true, hasPassword: false, rulesHash: 'x', createdAt: 1, phase },
    seats: [seat()],
    game: null,
  });
  view = reduce(view, snap(3), 1);
  assert.equal(view.revision, 3);
  view = reduce(view, snap(3), 2);
  assert.equal(view.droppedSnapshots, 1, '重复帧要去重');
  view = reduce(view, snap(2), 3);
  assert.equal(view.revision, 3, '旧帧不许把状态倒回去');
  assert.equal(view.droppedSnapshots, 2);
});

test('视图归约：票据先落袋，座位表随后；聊天环形缓冲有上限', () => {
  let view = emptyViewModel();
  view = reduce(view, { type: 'seatGranted', code: 'AB3D', seatId: 's1', ticket: 't', role: 'host', slot: 1, hostSeatId: 's1', serverNow: 1, manifest: { id: 'echo', name: '数字回声', version: '0.1.0', rulesHash: 'x', seats: { min: 2, max: 6 }, allowSpectate: true, soloFill: true, roles: ['host', 'player'], entry: 'client.js' } }, 1);
  assert.equal(view.mySeatId, 's1', 'seatGranted 先把座位与票据交出去');
  assert.equal(view.ticket, 't');
  assert.equal(mySeat(view), null, '还没收到座位表时不该假装知道座位细节');

  view = reduce(view, {
    type: 'snapshot',
    revision: 2,
    serverNow: 2,
    phase: 'lobby',
    room: { code: 'AB3D', name: '房', gameId: 'echo', gameName: '数字回声', hostSeatId: 's1', hostName: '甲', seatSlots: 4, occupied: 1, allowSpectate: true, hasPassword: false, rulesHash: 'x', createdAt: 1, phase: 'lobby' },
    seats: [seat({ seatId: 's1', role: 'host', name: '甲' })],
    game: null,
  }, 2);
  assert.equal(isHost(view), true);
  assert.equal(mySeat(view).role, 'host');

  for (let i = 0; i < 150; i += 1) {
    view = reduce(view, { type: 'chat', seatId: 's1', name: '甲', text: `第 ${i} 句`, at: i, kind: 'say' }, i);
  }
  assert.equal(view.chat.length, 120, '聊天记录只留最近一段');
  assert.equal(view.chat.at(-1).text, '第 149 句');
});

test('开局按钮的文案要把"还差谁"讲出来', () => {
  let view = emptyViewModel();
  view = reduce(view, {
    type: 'snapshot',
    revision: 1,
    serverNow: 1,
    phase: 'lobby',
    room: { code: 'AB3D', name: '房', gameId: 'echo', gameName: '数字回声', hostSeatId: 'h1', hostName: '房主', seatSlots: 4, occupied: 3, allowSpectate: true, hasPassword: false, rulesHash: 'x', createdAt: 1, phase: 'lobby' },
    seats: [
      seat({ seatId: 'h1', role: 'host', name: '房主', slot: 1 }),
      seat({ seatId: 'p2', name: '乙', ready: true, slot: 2 }),
      seat({ seatId: 'p3', name: '丙', slot: 3 }),
      seat({ seatId: 'sp', name: '看客', role: 'spectator', slot: 901 }),
    ],
    game: null,
  }, 1);
  const blockers = startBlockers(view);
  assert.deepEqual(blockers.unready, ['丙']);
  assert.equal(blockers.ok, false);
  assert.equal(blockers.tooFew, false);
  assert.deepEqual(emptySlots(view), [4], '观战不占玩家槽');
  assert.equal(seatLabel(view.seats[0]), '👑 房主');
  assert.equal(seatLabel(view.seats[3]), '👁 看客');
});

test('邀请链接带上房主地址、房号与游戏', () => {
  const link = inviteLink('http://192.168.1.20:3000', 'ab3d', 'echo');
  assert.match(link, /^http:\/\/192\.168\.1\.20:3000\/\?/);
  assert.match(link, /r=ab3d/);
  assert.match(link, /g=echo/);
});

function scriptedSocket() {
  let handlers = null;
  const socket = {
    send: () => {},
    close: () => handlers?.close(1006),
  };
  return {
    binding: {
      socket,
      bind(h) {
        handlers = h;
      },
    },
    server: (raw) => handlers?.message(raw),
    open: () => handlers?.open(),
    close: (code) => handlers?.close(code),
  };
}

test('重连退避：指数增长、封顶、加抖动，且手动重连不等计时', async () => {
  const queue = [];
  const timers = {
    setTimeout: (handler, ms) => {
      queue.push({ handler, ms });
      return queue.length;
    },
    clearTimeout: (handle) => {
      const index = Number(handle) - 1;
      if (queue[index]) queue[index].cancelled = true;
    },
  };
  const scripted = scriptedSocket();
  const seen = [];
  const conn = new PlatformConnection(
    {
      hello: () => ({ type: 'hello', protocol: 1, nick: '甲' }),
      onMessage: (m) => seen.push(m),
    },
    {
      factory: () => scripted.binding,
      timers,
      backoffBaseMs: 500,
      backoffMaxMs: 4_000,
      pingEveryMs: 0,
      random: () => 0,
    },
  );
  conn.connect('ws://x:1/ws');
  scripted.open();
  assert.equal(conn.currentState.status, 'open');
  scripted.close(1006);
  assert.equal(queue.length, 1, '断线要排一次重连');
  assert.equal(queue[0].ms, 500);
  scripted.close(1006);
  assert.equal(queue[1].ms, 1_000);
  scripted.close(1006);
  assert.equal(queue[2].ms, 2_000);
  scripted.close(1006);
  scripted.close(1006);
  scripted.close(1006);
  const last = queue.at(-1);
  assert.ok(last.ms <= 4_000, `退避必须封顶，实际 ${last.ms}`);

  // 连上了就把次数清零，别把一晚上的失败都算在下次头上
  scripted.open();
  assert.equal(conn.currentState.attempts, 0);
  scripted.close(1006);
  assert.equal(queue.at(-1).ms, 500);

  conn.retryNow();
  assert.equal(conn.currentState.status, 'retrying', '点重连要立刻再试，不等退避计时');
  assert.equal(queue.at(-1).cancelled, true, '手动重连应当把刚排上的自动重连取消掉，否则一次点击连发两遍');
});
