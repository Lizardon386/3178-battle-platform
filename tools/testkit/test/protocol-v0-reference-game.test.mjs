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

function setup({ localHost = true } = {}) {
  const platform = new MockSessionService();
  platform.registerGame(manifest);
  const game = new ReferenceGame(platform);
  platform.useAuthority(() => game);
  const host = platform.connect({ local: localHost });
  const guest = platform.connect();
  platform.receive(host, { type: 'hello', protocolVersion: 0, capabilities: ['ready', 'start'], clientKind: 'web' });
  platform.receive(guest, { type: 'hello', protocolVersion: 0, capabilities: ['ready', 'start'], clientKind: 'web' });
  return { platform, game, host, guest };
}

function createSession(platform, host) {
  platform.receive(host, {
    type: 'sessionCreate', gameId: 'color-duel', version: '0.3.0', config: { cap: '20' },
    memberSlots: 8, spectatorLimit: 4, options: {}, profile: { nick: '房主老周', displayColor: '#f59e0b' }, roomName: '周末一局',
  });
}

function createAndJoin(platform, host, guest) {
  createSession(platform, host);
  platform.receive(guest, {
    type: 'sessionJoin', code: '893F', gameId: 'color-duel', version: '0.3.0', rulesHash: platform.current.rulesHash,
    credentials: {}, role: 'player', profile: { nick: '小林', displayColor: '#6366f1' },
  });
}

function readyAndStart(platform, host, guest) {
  platform.receive(host, { type: 'setReady', ready: true });
  platform.receive(guest, { type: 'setReady', ready: true });
  platform.receive(host, { type: 'startGame' });
}

function openGameChannel(platform, guest) {
  platform.receive(guest, { type: 'gameHandoff' });
  const handoff = last(guest, 'gameHandoff');
  const gameClient = platform.connect();
  platform.receive(gameClient, { type: 'gameAuth', handoffCode: handoff.handoffCode });
  return gameClient;
}

const last = (client, type) => client.inbox.filter((message) => message.type === type).at(-1);
const errors = (client, code) => client.inbox.filter((message) => message.type === 'error' && message.code === code);

test('参考链路：准备闸通过前无权威，通过后只启动一次并携带房主身份与 epoch', () => {
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
  assert.equal(platform.current.authorityEpoch, 1);
  const start = game.received.find((message) => message.type === 'start');
  assert.equal(start.hostMemberId, 'm1');
  assert.equal(start.authorityEpoch, 1);
  assert.equal(start.members.length, 2);
  platform.receive(host, { type: 'startGame' });
  assert.equal(errors(host, 'PHASE').length, 1);
  assert.equal(platform.authorityStarts, 1);
});

test('参考链路：只有本机控制面能建房，远程连接被拒', () => {
  const { platform, host } = setup({ localHost: false });
  createSession(platform, host);
  assert.equal(platform.current, null);
  assert.equal(errors(host, 'FORBIDDEN').length, 1);
});

test('参考链路：sessionProbe 返回与当前会话一致的全量预览', () => {
  const { platform, host } = setup();
  createSession(platform, host);
  const probe = platform.connect();
  platform.receive(probe, { type: 'sessionProbe', code: '893F' });
  const preview = last(probe, 'sessionPreview');
  assert.equal(preview.code, '893F');
  assert.equal(preview.gameId, 'color-duel');
  assert.equal(preview.rulesHash, platform.current.rulesHash);
  assert.deepEqual(preview.requiredCapabilities, ['toSeat']);
  assert.equal(preview.lateJoin, 'spectator');
  assert.equal(preview.memberSlots, 8);
  assert.equal(preview.spectatorLimit, 4);
  assert.equal(preview.manifest.sessionConfig.fields.length, manifest.sessionConfig.fields.length);
  assert.match(preview.manifestHash, /^[0-9a-f]{64}$/);
});

test('参考链路：一次性交接、唯一游戏连接、越通道与重复 actionId', () => {
  const { platform, game, host, guest } = setup();
  createAndJoin(platform, host, guest);
  readyAndStart(platform, host, guest);
  const gameClient = openGameChannel(platform, guest);
  const granted = last(gameClient, 'gameGranted');
  assert.equal(granted.memberId, 'm2');
  assert.equal(granted.authorityEpoch, 1);

  platform.receive(host, { type: 'game', actionId: 'from-session', payload: {} });
  assert.equal(errors(host, 'FORBIDDEN').length, 1);

  platform.receive(gameClient, { type: 'game', actionId: 'a1', payload: { op: 'bump' } });
  assert.equal(game.currentCount, 1);
  platform.receive(gameClient, { type: 'game', actionId: 'a1', payload: { op: 'bump' } });
  assert.equal(game.currentCount, 1, 'duplicate actionId must not be delivered twice');

  platform.receive(gameClient, { type: 'startGame' });
  assert.equal(errors(gameClient, 'FORBIDDEN').length, 1);

  const hostGames = host.inbox.filter((message) => message.type === 'game');
  assert.equal(hostGames.length, 0, 'management connection must not receive game messages');
  const guestGames = gameClient.inbox.filter((message) => message.type === 'game');
  assert.deepEqual(guestGames.at(-1).payload, { privateLastAction: { op: 'bump' } });

  const second = platform.connect();
  platform.receive(second, { type: 'gameAuth', gameTicket: granted.gameTicket });
  assert.equal(last(second, 'gameGranted').memberId, 'm2');
  assert.equal(gameClient.connected, false, 'old game connection must be invalidated');

  assert.throws(() => platform.receiveFromAuthority({
    type: 'deliver', gameSequence: 2, authorityEpoch: 99, items: [{ to: 'm2', payload: { stale: true } }],
  }), /stale authority epoch/);
});

test('参考链路：断线凭票回原 member，游戏通道用 sync 补私密视图', () => {
  const { platform, game, host, guest } = setup();
  createAndJoin(platform, host, guest);
  readyAndStart(platform, host, guest);
  const gameClient = openGameChannel(platform, guest);
  platform.receive(gameClient, { type: 'game', actionId: 'a1', payload: { op: 'bump' } });
  platform.disconnect(guest);
  assert.equal(game.received.filter((message) => message.type === 'memberLeave' && message.reason === 'disconnected').length, 1);
  const ticket = guest.ticket;
  const reconnected = platform.connect();
  platform.receive(reconnected, { type: 'resume', sessionId: platform.current.id, code: '893F', ticket });
  assert.equal(last(reconnected, 'seatGranted').memberId, 'm2');
  assert.ok(game.received.some((message) => message.type === 'memberResume' && message.memberId === 'm2'));
  platform.receive(gameClient, { type: 'sync' });
  assert.deepEqual(gameClient.inbox.filter((message) => message.type === 'game').at(-1).payload, { privateLastAction: { op: 'bump' } });
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
  platform.receive(host, { type: 'transferHost', targetMemberId: 'm2' });
  assert.equal(platform.current.hostMemberId, 'm2');
  assert.equal(game.currentHostMemberId, 'm2');
  assert.ok(game.received.some((message) => message.type === 'hostChanged' && message.hostMemberId === 'm2'));
});

test('参考链路：权威失败后可 recoverGame 换 epoch，旧凭证与旧 epoch 失效', () => {
  const { platform, game, host, guest } = setup();
  createAndJoin(platform, host, guest);
  readyAndStart(platform, host, guest);
  const gameClient = openGameChannel(platform, guest);
  const oldTicket = last(gameClient, 'gameGranted').gameTicket;
  platform.receiveFromAuthority({ type: 'authorityError', authorityEpoch: 1, code: 'INIT', text: 'boom', fatal: true });
  assert.equal(platform.current.gameProcess, 'failed');
  platform.receive(gameClient, { type: 'recoverGame' });
  assert.equal(errors(gameClient, 'FORBIDDEN').length, 1);
  platform.receive(host, { type: 'recoverGame' });
  assert.equal(platform.current.gameProcess, 'running');
  assert.equal(platform.current.authorityEpoch, 2);
  assert.equal(platform.authorityStarts, 2);
  assert.throws(() => platform.receiveFromAuthority({
    type: 'deliver', gameSequence: 9, authorityEpoch: 1, items: [{ to: 'm2', payload: { stale: true } }],
  }), /stale authority epoch/);
  const again = platform.connect();
  platform.receive(again, { type: 'gameAuth', gameTicket: oldTicket });
  assert.equal(errors(again, 'HANDOFF').length, 1, 'epoch change must revoke old game tickets');
  platform.receive(host, { type: 'recoverGame' });
  assert.equal(errors(host, 'PHASE').length, 1);
});

test('参考链路：房主离开被拒，关会话撤销游戏凭证', () => {
  const { platform, host, guest } = setup();
  createAndJoin(platform, host, guest);
  readyAndStart(platform, host, guest);
  const gameClient = openGameChannel(platform, guest);
  const oldTicket = last(gameClient, 'gameGranted').gameTicket;
  platform.receive(host, { type: 'leave' });
  assert.equal(errors(host, 'HOSTONLY').length, 1);
  platform.receive(host, { type: 'closeSession' });
  assert.equal(platform.current.state, 'closed');
  const again = platform.connect();
  platform.receive(again, { type: 'gameAuth', gameTicket: oldTicket });
  assert.equal(errors(again, 'HANDOFF').length, 1);
});

test('参考链路：额外字段与未知客户端消息都被 BADMSG 拒绝', () => {
  const { platform, host } = setup();
  platform.receive(host, { type: 'hello', protocolVersion: 0, capabilities: [], clientKind: 'web', gameId: 'old' });
  assert.ok(errors(host, 'BADMSG').length >= 1);
  platform.receive(host, { type: 'notARealMessage' });
  assert.ok(errors(host, 'BADMSG').length >= 2);
});
