import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockSessionService } from '../dist/protocol-v0/mock-session-service.js';
import { ReferenceGame } from '../dist/protocol-v0/reference-game.js';

const manifest = JSON.parse(fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../protocol/v0/examples/manifest-color-duel.json'),
  'utf8',
));

function setup() {
  const platform = new MockSessionService();
  platform.registerGame(manifest);
  const game = new ReferenceGame(platform);
  platform.useAuthority(() => game);
  const host = platform.connect();
  const guest = platform.connect();
  platform.receive(host, { type: 'hello', protocolVersion: 0, capabilities: ['ready', 'start'], clientKind: 'web' });
  platform.receive(guest, { type: 'hello', protocolVersion: 0, capabilities: ['ready', 'start'], clientKind: 'web' });
  return { platform, game, host, guest };
}

function createAndJoin(platform, host, guest) {
  platform.receive(host, {
    type: 'sessionCreate', gameId: 'color-duel', version: '0.3.0', config: { cap: '20' },
    memberSlots: 8, options: {}, profile: { nick: '房主老周', displayColor: '#f59e0b' }, roomName: '周末一局',
  });
  platform.receive(guest, {
    type: 'sessionJoin', code: '893F', gameId: 'color-duel', version: '0.3.0', rulesHash: platform.current.rulesHash,
    credentials: {}, profile: { nick: '小林', displayColor: '#6366f1' },
  });
}

function readyAndStart(platform, host, guest) {
  platform.receive(host, { type: 'setReady', ready: true });
  platform.receive(guest, { type: 'setReady', ready: true });
  platform.receive(host, { type: 'startGame' });
}

const last = (client, type) => client.inbox.filter((message) => message.type === type).at(-1);
const errors = (client, code) => client.inbox.filter((message) => message.type === 'error' && message.code === code);

test('参考链路：准备闸通过前无权威，通过后只启动一次并携带房主身份', () => {
  const { platform, game, host, guest } = setup();
  createAndJoin(platform, host, guest);
  platform.receive(host, { type: 'startGame' });
  assert.equal(errors(host, 'NOTREADY').length, 1);
  assert.equal(platform.authorityStarts, 0);
  platform.receive(host, { type: 'setReady', ready: true });
  platform.receive(host, { type: 'startGame' });
  assert.equal(errors(host, 'NOTREADY').length, 2);
  assert.equal(platform.authorityStarts, 0);
  platform.receive(guest, { type: 'setReady', ready: true });
  platform.receive(host, { type: 'startGame' });
  assert.equal(platform.authorityStarts, 1);
  assert.equal(platform.current.gameProcess, 'running');
  const start = game.received.find((message) => message.type === 'start');
  assert.equal(start.hostSeatId, 1);
  assert.equal(start.members.length, 2);
  platform.receive(host, { type: 'startGame' });
  assert.equal(errors(host, 'PHASE').length, 1);
  assert.equal(platform.authorityStarts, 1);
});

test('参考链路：一次性交接、受限 gameTicket、公共与私密投递不串座', () => {
  const { platform, game, host, guest } = setup();
  createAndJoin(platform, host, guest);
  readyAndStart(platform, host, guest);
  platform.receive(guest, { type: 'gameHandoff' });
  const handoff = last(guest, 'gameHandoff');
  const gameClient = platform.connect();
  platform.receive(gameClient, { type: 'gameAuth', handoffCode: handoff.handoffCode });
  assert.equal(last(gameClient, 'gameGranted').seatId, 2);
  const reused = platform.connect();
  platform.receive(reused, { type: 'gameAuth', handoffCode: handoff.handoffCode });
  assert.equal(errors(reused, 'HANDOFF').length, 1);
  platform.receive(gameClient, { type: 'startGame' });
  assert.equal(errors(gameClient, 'FORBIDDEN').length, 1);
  platform.receive(gameClient, { type: 'game', payload: { op: 'bump' } });
  assert.equal(game.currentCount, 1);
  const hostGames = host.inbox.filter((message) => message.type === 'game');
  assert.deepEqual(hostGames.at(-1).payload, { count: 1 });
  assert.equal(hostGames.some((message) => message.payload.privateLastAction), false);
  const privateView = gameClient.inbox.filter((message) => message.type === 'game').map((message) => message.payload).find((payload) => payload.privateLastAction);
  assert.deepEqual(privateView, { privateLastAction: { op: 'bump' } });
});

test('参考链路：断线凭票回原座，旧 close 不覆盖新连接，权威补最新私密状态', () => {
  const { platform, game, host, guest } = setup();
  createAndJoin(platform, host, guest);
  readyAndStart(platform, host, guest);
  platform.receive(guest, { type: 'game', payload: { op: 'bump' } });
  platform.disconnect(guest);
  assert.equal(game.received.filter((message) => message.type === 'memberLeave' && message.reason === 'disconnected').length, 1);
  const ticket = guest.ticket;
  const reconnected = platform.connect();
  platform.receive(reconnected, { type: 'resume', code: '893F', ticket });
  assert.equal(last(reconnected, 'seatGranted').seatId, 2);
  assert.equal(platform.current.members.find((member) => member.seatId === 2).connectionId, reconnected.id);
  assert.ok(game.received.some((message) => message.type === 'memberResume' && message.seatId === 2));
  const privateView = reconnected.inbox.filter((message) => message.type === 'game').at(-1);
  assert.deepEqual(privateView.payload, { privateLastAction: { op: 'bump' } });
  const leaves = game.received.filter((message) => message.type === 'memberLeave').length;
  platform.disconnect(guest);
  assert.equal(game.received.filter((message) => message.type === 'memberLeave').length, leaves);
  const revisions = host.inbox.filter((message) => message.type === 'sessionState').map((message) => message.revision);
  assert.deepEqual(revisions, [...revisions].sort((a, b) => a - b));
  assert.equal(new Set(revisions).size, revisions.length);
});

test('参考链路：配置变更重置真人准备，房主移交有 hostChanged', () => {
  const { platform, game, host, guest } = setup();
  createAndJoin(platform, host, guest);
  const before = platform.current.rulesHash;
  platform.receive(host, { type: 'setReady', ready: true });
  platform.receive(guest, { type: 'setReady', ready: true });
  platform.receive(host, { type: 'setConfig', config: { cap: '30' } });
  assert.notEqual(platform.current.rulesHash, before);
  assert.equal(platform.current.members.every((member) => !member.ready), true);
  platform.receive(host, { type: 'startGame' });
  assert.equal(errors(host, 'NOTREADY').length, 1);
  readyAndStart(platform, host, guest);
  platform.receive(host, { type: 'transferHost', targetSeat: 2 });
  assert.equal(platform.current.hostSeatId, 2);
  assert.equal(game.currentHostSeatId, 2);
  assert.ok(game.received.some((message) => message.type === 'hostChanged' && message.hostSeatId === 2));
});

test('参考链路：额外字段与未知客户端消息都被 BADMSG 拒绝', () => {
  const { platform, host } = setup();
  platform.receive(host, { type: 'hello', protocolVersion: 0, capabilities: [], clientKind: 'web', gameId: 'old' });
  assert.ok(errors(host, 'BADMSG').length >= 1);
  platform.receive(host, { type: 'notARealMessage' });
  assert.ok(errors(host, 'BADMSG').length >= 2);
});
