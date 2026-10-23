import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRulesHash,
  checkProtocol,
  checkHandshake,
  parseClientMessage,
  parseServerMessage,
  normalizeCode,
  isHostCommand,
  isGameManifest,
  MESSAGE_CATALOG,
  PROTOCOL_VERSION,
} from '@bp/protocol';
import { canonicalJson, stableDigest } from '@bp/core-abi';

test('稳定摘要与键顺序无关（旧 deckVersion 的泛化）', () => {
  const a = { stack: true, peng: false, cap: 20 };
  const b = { cap: 20, peng: false, stack: true };
  assert.equal(stableDigest(a), stableDigest(b));
  assert.equal(computeRulesHash(a), computeRulesHash(b));
  assert.notEqual(stableDigest(a), stableDigest({ ...a, cap: 30 }));
});

test('规范化 JSON：嵌套排序、数组保序、undefined 归 null', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(canonicalJson([2, 1, { z: 1, y: undefined }]), '[2,1,{"z":1}]');
  assert.equal(canonicalJson(null), 'null');
  assert.throws(() => {
    const cyclic = { name: 'x' };
    cyclic.self = cyclic;
    canonicalJson(cyclic);
  }, /循环/);
});

test('Node 与浏览器共用同一实现：摘要只依赖 TextEncoder', () => {
  assert.match(stableDigest('hello'), /^[0-9a-f]{16}$/);
});

test('协议版本闸：两端谁旧都能说清', () => {
  assert.deepEqual(checkProtocol(PROTOCOL_VERSION), { ok: true });
  assert.equal(checkProtocol(0).ok, false);
  const tooNew = checkProtocol(PROTOCOL_VERSION + 1, PROTOCOL_VERSION);
  assert.equal(tooNew.ok, false);
  assert.match(tooNew.ok === false ? tooNew.message : '', /房主协议过旧/);
});

test('握手区分"版本不同"和"房规不同"', () => {
  const want = { version: '1.2.0', rulesHash: 'aaaa' };
  assert.deepEqual(checkHandshake(want, {}), { ok: true });
  assert.equal(checkHandshake(want, { version: '1.1.0' }).ok, false);
  const rules = checkHandshake(want, { version: '1.2.0', rulesHash: 'bbbb' });
  assert.equal(rules.ok, false);
  if (!rules.ok) assert.equal(rules.code, 'RULES');
});

test('入站消息形状闸门：缺字段/多余字段/超长都要挡住', () => {
  assert.equal(parseClientMessage({ type: 'hello', protocol: 1, nick: '甲' }).ok, true);
  assert.equal(parseClientMessage({ type: 'hello', nick: '甲' }).ok, false);
  assert.equal(parseClientMessage({ type: 'hello', protocol: 1, nick: '甲', extra: 1 }).ok, false);
  assert.equal(parseClientMessage('{"type":"ping","nonce":"n"}').ok, true);
  assert.equal(parseClientMessage('{坏 JSON').ok, false);
  assert.equal(parseClientMessage({ type: 'chat', text: 'x'.repeat(301) }).ok, false);
  assert.equal(parseClientMessage({ type: 'nope' }).ok, false);
  assert.equal(parseServerMessage({ type: 'snapshot', revision: 3, serverNow: 1, room: {}, seats: [], phase: 'lobby' }).ok, true);
  assert.equal(parseServerMessage({ type: 'snapshot', revision: 3, serverNow: 1, room: [], seats: [], phase: 'lobby' }).ok, false);
  assert.equal(parseServerMessage({ type: 'chat', seatId: 's1', name: '甲', text: '来了', at: 1, kind: 'say' }).ok, true);
});

test('房主命令表与目录一致，权限判定不会漏一条', () => {
  assert.ok(isHostCommand('hostStart'));
  assert.ok(!isHostCommand('ready'));
  const hostTypes = MESSAGE_CATALOG.filter((e) => e.requiresHost).map((e) => e.type).sort();
  assert.deepEqual(hostTypes, ['hostClose', 'hostKick', 'hostSeat', 'hostStart', 'hostTransfer']);
});

test('房号规范化：大小写与空格不影响查房', () => {
  assert.equal(normalizeCode(' 7kdt '), '7KDT');
  assert.equal(normalizeCode(undefined), '');
});

test('manifest 形状检查挡住越界声明', () => {
  const base = {
    id: 'fixture-turn',
    name: '测试夹具·回合制',
    version: '0.1.0',
    rulesHash: stableDigest({}),
    seats: { min: 2, max: 4 },
    entry: 'client.js',
  };
  assert.ok(isGameManifest(base));
  assert.ok(!isGameManifest({ ...base, id: 'Bad Id' }));
  assert.ok(!isGameManifest({ ...base, seats: { min: 0, max: 4 } }));
  assert.ok(!isGameManifest({ ...base, entry: 'https://evil/x.js' }));
  assert.ok(!isGameManifest({ ...base, entry: '../../etc/passwd' }));
  assert.ok(isGameManifest({ ...base, ui: { chat: 'game' } }));
  assert.ok(isGameManifest({ ...base, ui: {} }));
  assert.ok(!isGameManifest({ ...base, ui: { chat: 'both' } }));
  assert.ok(!isGameManifest({ ...base, ui: 'game' }));
  assert.ok(!isGameManifest({ ...base, ui: { chat: 'game', extra: 1 } }));
});
