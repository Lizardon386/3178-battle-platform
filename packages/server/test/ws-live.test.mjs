import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { Engine, WsTransport } from '@bp/server';
import echoModule from '@bp/game-echo';
import turncountModule from '@bp/game-turncount';

/**
 * 真 WebSocket 端到端：走 HTTP 起服务、真客户端连、真 socket 收帧。
 * 契约测试证明的是"逻辑无关玩法"，这里证明的是"传输层真的能把那套逻辑跑起来"。
 */

function bootPlatform(modules = [echoModule, turncountModule], transportOptions = {}) {
  const engine = new Engine({ modules });
  const transport = new WsTransport(engine, transportOptions);
  const server = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  transport.attach(server);
  const timer = setInterval(() => transport.tick(), 50);
  return {
    engine,
    transport,
    url: (port) => `ws://127.0.0.1:${port}/ws`,
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    async stop() {
      clearInterval(timer);
      await transport.close();
      await Promise.race([
        new Promise((resolve) => server.close(resolve)),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    },
  };
}

class Client {
  constructor(url, nick, helloExtra = {}) {
    this.ws = new WebSocket(url);
    this.messages = [];
    this.closed = null;
    this.nick = nick;
    this.helloExtra = helloExtra;
    this.ws.on('message', (data) => this.messages.push(JSON.parse(data.toString())));
    this.ws.on('close', (code) => {
      this.closed = code;
    });
  }

  opened() {
    // socket 可能在我们挂监听之前就已经 open 了，直接看 readyState，别等事件。
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.ws.readyState > WebSocket.OPEN) return Promise.reject(new Error('socket 已关闭'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接超时')), 3000);
      this.ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async hello() {
    await this.opened();
    this.push({ type: 'hello', protocol: 1, nick: this.nick, ...this.helloExtra });
    return this.until('welcome');
  }

  push(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  /** 等到"符合期望的那一帧"，而不是"随便一帧该类型的"——在途的旧快照会先到。 */
  async until(type, timeoutMs = 2000, predicate = () => true) {
    const started = Date.now();
    for (;;) {
      const found = this.messages.find((m) => m.type === type && predicate(m));
      if (found) return found;
      if (Date.now() - started > timeoutMs) {
        throw new Error(`没等到符合条件的 ${type}：${JSON.stringify(this.messages.map((m) => m.type ?? m.code))}`);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  async nextRevision(known, timeoutMs = 2000) {
    const started = Date.now();
    for (;;) {
      const snap = [...this.messages].reverse().find((m) => m.type === 'snapshot' && m.revision > known);
      if (snap) return snap;
      if (Date.now() - started > timeoutMs) throw new Error(`revision 没推进（停在 ${known}）`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  last(type) {
    return [...this.messages].reverse().find((m) => m.type === type);
  }
}

test('真 socket：建房→入座→准备→开局→出招，两端各自拿到自己的视角', async () => {
  const platform = bootPlatform();
  const port = await platform.listen();
  const url = platform.url(port);
  const host = new Client(url, '房主', { gameId: 'echo', version: echoModule.version });
  const guest = new Client(url, '客人', { gameId: 'echo', version: echoModule.version });
  await host.hello();
  await guest.hello();

  host.push({
    type: 'roomCreate',
    gameId: 'echo',
    roomName: '真连一局',
    seatSlots: 4,
    config: { range: 6, target: 3, turnMs: 20000 },
  });
  const hostGranted = await host.until('seatGranted');
  assert.equal(hostGranted.role, 'host');
  const room = await host.until('snapshot');
  assert.equal(room.room.name, '真连一局');

  guest.push({ type: 'roomJoin', code: room.room.code });
  const guestGranted = await guest.until('seatGranted');
  assert.ok(guestGranted.ticket.length >= 16);
  const guestSnap = await guest.nextRevision(0);
  assert.equal(guestSnap.seats.length, 2);

  guest.push({ type: 'ready', ready: true });
  await guest.nextRevision(guestSnap.revision);
  host.messages.length = 0;
  host.push({ type: 'hostStart' });
  const playing = await host.until('snapshot', 2000, (m) => m.phase === 'playing');
  assert.equal(playing.phase, 'playing');

  const current = playing.game.current;
  const actor = current === hostGranted.seatId ? host : guest;
  const otherId = current === hostGranted.seatId ? guestGranted.seatId : hostGranted.seatId;
  actor.push({ type: 'gameAction', name: 'guess', payload: { targetSeatId: otherId, value: 4 } });
  const after = await host.until('snapshot', 2000, (m) => m.game && m.game.current !== current);
  assert.equal(after.game.current !== current, true, '回合应该轮转');
  assert.notEqual(after.game.mySecret, undefined, '每端都只拿到自己的秘密');
  assert.equal(after.seats.length, 2);

  // 换第二个游戏：同一套传输与引擎，形状完全不同
  host.push({ type: 'hostClose' });
  host.messages.length = 0;
  host.push({ type: 'roomCreate', gameId: 'turncount', roomName: '一起数到', seatSlots: 4, config: { goal: 3, limitMs: 60000 } });
  const countRoom = await host.until('snapshot', 2000, (m) => m.room.gameId === 'turncount');
  assert.equal(countRoom.room.gameId, 'turncount');
  guest.messages.length = 0;
  guest.push({ type: 'roomJoin', code: countRoom.room.code });
  await guest.until('seatGranted');
  guest.push({ type: 'ready', ready: true });
  host.messages.length = 0;
  host.push({ type: 'hostStart' });
  const countPlaying = await host.until('snapshot', 2000, (m) => m.phase === 'playing');
  assert.equal(countPlaying.phase, 'playing');
  assert.equal(countPlaying.game.kind, 'count');
  host.push({ type: 'gameAction', name: 'plus' });
  host.push({ type: 'gameAction', name: 'plus' });
  host.push({ type: 'gameAction', name: 'plus' });
  const won = await host.until('snapshot', 2000, (m) => m.game && m.game.value === 3);
  assert.equal(won.game.value, 3);

  await platform.stop();
  host.ws.terminate();
  guest.ws.terminate();
});

test('同票据的第二台设备会顶掉旧连接，错票据进不来', async () => {
  const platform = bootPlatform();
  const port = await platform.listen();
  const url = platform.url(port);
  const host = new Client(url, '房主');
  await host.hello();
  host.push({ type: 'roomCreate', gameId: 'echo', roomName: '顶号', seatSlots: 3, config: {} });
  const code = (await host.until('snapshot')).room.code;
  const guest = new Client(url, '客人');
  await guest.hello();
  guest.push({ type: 'roomJoin', code });
  const granted = await guest.until('seatGranted');

  const thief = new Client(url, '猜号者');
  await thief.hello();
  thief.push({ type: 'seatResume', code, seatId: granted.seatId, ticket: '瞎猜' });
  const denied = await thief.until('error');
  assert.equal(denied.code, 'NOSEAT');

  const second = new Client(url, '客人第二台');
  await second.hello();
  second.push({ type: 'seatResume', code, seatId: granted.seatId, ticket: granted.ticket });
  await second.until('seatGranted');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(guest.closed, 1008, '旧设备要被关闭，座位只有一个主人');
  assert.equal(platform.engine.registry.get(code).seat(granted.seatId).connected, true);

  await platform.stop();
  for (const c of [host, guest, thief, second]) c.ws.terminate();
});

test('坏帧回 BADMSG 且不断链；未 hello 的消息被挡', async () => {
  const platform = bootPlatform();
  const port = await platform.listen();
  const url = platform.url(port);
  const raw = new WebSocket(url);
  const seen = [];
  raw.on('message', (d) => seen.push(JSON.parse(d.toString())));
  await new Promise((r) => raw.once('open', r));
  raw.send('这不是 JSON');
  raw.send(JSON.stringify({ type: 'nope' }));
  raw.send(JSON.stringify({ type: 'chat', text: '没 hello 就想说话' }));
  await new Promise((r) => setTimeout(r, 80));
  const codes = seen.filter((m) => m.type === 'error').map((m) => m.code);
  assert.deepEqual(codes, ['BADMSG', 'BADMSG', 'PROTOCOL']);
  assert.equal(raw.readyState, 1, '只报错，不踢人');
  raw.close();
  await platform.stop();
});

test('Origin 白名单：给了列表就拦陌生来源，没给就放行（本机壳连远程房主要靠放行）', async () => {
  const open = bootPlatform();
  const port = await open.listen();
  const intruder = new WebSocket(open.url(port), { headers: { Origin: 'http://evil.example' } });
  const got = [];
  intruder.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => intruder.once('open', r));
  intruder.send(JSON.stringify({ type: 'hello', protocol: 1, nick: '甲' }));
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(got.some((m) => m.type === 'welcome'), '默认放行跨源连接');
  await open.stop();
  intruder.terminate();

  const strict = bootPlatform([echoModule], { allowOrigins: ['http://127.0.0.1:3178'] });
  const p2 = await strict.listen();
  const blocked = new WebSocket(strict.url(p2), { headers: { Origin: 'http://evil.example' } });
  const closed = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 2000);
    blocked.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    blocked.once('error', () => {
      clearTimeout(timer);
      resolve('error');
    });
  });
  assert.ok(closed === 1008 || closed === 'error', `陌生来源应被挡掉，实际 ${closed}`);
  await strict.stop();
  blocked.terminate();
});
