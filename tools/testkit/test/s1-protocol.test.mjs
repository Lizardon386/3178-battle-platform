import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateJson } from '../dist/protocol-v0/schema-validator.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../protocol/v0');
const read = (name) => JSON.parse(fs.readFileSync(path.join(rootDir, name), 'utf8'));
const schema = read('messages.schema.json');
const catalog = read('catalog.json');

function assertValid(value) {
  assert.deepEqual(validateJson(value, schema, schema), []);
}
function assertInvalid(value, includes, definition) {
  const rule = definition ? { $ref: `#/$defs/${definition}` } : schema;
  const errors = validateJson(value, rule, schema);
  assert.ok(errors.length > 0, 'expected schema rejection');
  if (includes) assert.ok(errors.some((error) => error.includes(includes)), errors.join('\n'));
}

test('S1 catalog：每个方向条目都有唯一 schema，type 与权限字段一致', () => {
  assert.equal(catalog.protocolVersion, 0);
  const keys = new Set();
  for (const message of catalog.messages) {
    const key = `${message.from}->${message.to}:${message.type}`;
    assert.ok(!keys.has(key), `duplicate ${key}`);
    keys.add(key);
    const definition = schema.$defs[message.schema];
    assert.ok(definition, message.schema);
    assert.equal(definition.additionalProperties, false, message.schema);
    assert.ok(definition.required.includes('type'), message.schema);
    assert.equal(definition.properties.type.const, message.type, message.schema);
  }
  const rootRefs = new Set(schema.anyOf.map((rule) => rule.$ref.replace('#/$defs/', '')));
  assert.deepEqual(rootRefs, new Set(catalog.messages.map((message) => message.schema)));
});

test('S1 examples：所有示例都通过根 schema', () => {
  const dir = path.join(rootDir, 'examples');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json') && !name.startsWith('manifest-'));
  assert.ok(files.length >= 8);
  for (const name of files) assertValid(read(`examples/${name}`));
});

test('S1 严格形状：额外字段、错误版本与未知 type 都拒绝', () => {
  assertInvalid({ ...read('examples/hello.json'), gameId: 'color-duel' }, 'extra field', 'ClientHello');
  assertInvalid({ ...read('examples/hello.json'), protocolVersion: 1 });
  assertInvalid({ type: 'notARealMessage' });
});

test('S1 profile：displayColor 必须是 hex，不接受 CSS 变量', () => {
  const value = read('examples/session-state.json');
  value.members[0].profile.displayColor = 'var(--bp-seat-amber)';
  assertInvalid(value, 'pattern', 'ServerSessionState');
});

test('S1 权威投递：空 items 拒绝，座位与 all 可混合', () => {
  assertValid(read('examples/authority-deliver.json'));
  assertInvalid({ type: 'deliver', items: [] }, 'too few', 'AuthorityDeliver');
  assertInvalid({ type: 'deliver', items: [{ to: 0, payload: {} }] });
});

test('S1 游戏交接：handoffCode / gameTicket 至少一个，管理 ticket 不可混入', () => {
  assertValid(read('examples/game-auth.json'));
  assertValid({ type: 'gameAuth', gameTicket: 'game-ticket-123456' });
  assertInvalid({ type: 'gameAuth' }, 'anyOf', 'ClientGameAuth');
  assertInvalid({ type: 'gameAuth', ticket: 'ticket-1234567890' }, 'extra field', 'ClientGameAuth');
});

test('S1 游戏通道只开放 gameAuth / game / ping，管理动作留在会话通道', () => {
  const gameTypes = catalog.messages.filter((message) => message.channel === 'game' && message.from === 'client').map((message) => message.type).sort();
  assert.deepEqual(gameTypes, ['game', 'gameAuth', 'ping']);
  for (const type of ['setReady', 'startGame', 'setConfig', 'kick', 'transferHost', 'closeSession']) {
    assert.equal(catalog.messages.find((message) => message.type === type && message.from === 'client').channel, 'session');
  }
});

test('S1 错误码与能力清单唯一，新增平台边界码齐全', () => {
  const errors = read('errors.json');
  const codes = errors.platformErrors.map((item) => item.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of ['NOTREADY', 'GAMEFAILED', 'HANDOFF', 'FORBIDDEN', 'CONFIG', 'UNKNOWN_GAME']) assert.ok(codes.includes(code));
  const capabilities = read('capabilities.json').items.map((item) => item.id);
  assert.equal(new Set(capabilities).size, capabilities.length);
  for (const id of ['game.handoff', 'ready', 'start', 'resume']) assert.ok(capabilities.includes(id));
});

test('S1 生命周期消息闭合：准备、开始、启动快照、权威就绪与进程错误均存在', () => {
  const keys = new Set(catalog.messages.map((message) => `${message.from}->${message.to}:${message.type}`));
  for (const key of [
    'client->platform:setReady', 'client->platform:startGame',
    'platform->authority:start', 'authority->platform:authorityReady',
    'authority->platform:authorityError', 'platform->client:sessionState'
  ]) assert.ok(keys.has(key), key);
});

function assertDefinition(value, definition) {
  assert.deepEqual(validateJson(value, { $ref: `#/$defs/${definition}` }, schema), []);
}

test('S1 golden：41 个方向条目逐个有代表帧并通过具体 schema', () => {
  const golden = read('golden/messages.json');
  assert.equal(golden.length, catalog.messages.length);
  const byKey = new Map(golden.map((entry) => [`${entry.from}->${entry.to}:${entry.type}`, entry]));
  for (const message of catalog.messages) {
    const key = `${message.from}->${message.to}:${message.type}`;
    const entry = byKey.get(key);
    assert.ok(entry, `missing golden ${key}`);
    assertDefinition(entry.value, message.schema);
    assertValid(entry.value);
  }
});

test('S1 方向：两个 deliver 不能互换，hostChanged 与离席原因入契约', () => {
  const platformDeliver = read('golden/messages.json').find((entry) => entry.name === 'platform-authority-deliver').value;
  const authorityDeliver = read('golden/messages.json').find((entry) => entry.name === 'authority-platform-deliver').value;
  assertInvalid(platformDeliver, 'missing', 'AuthorityDeliver');
  assertInvalid(authorityDeliver, 'missing', 'PlatformDeliver');
  assertDefinition({ type: 'hostChanged', hostSeatId: 2, revision: 10 }, 'PlatformHostChanged');
  assertInvalid({ type: 'memberLeave', seatId: 2, reason: '网络不好', revision: 7 }, undefined, 'PlatformMemberLeave');
});

test('S1 manifest：color-duel 清单通过，路径穿越与未知字段拒绝', () => {
  const manifestSchema = read('manifest.schema.json');
  const manifest = read('examples/manifest-color-duel.json');
  assert.deepEqual(validateJson(manifest, manifestSchema, manifestSchema), []);
  assert.equal(manifest.name, '变色对决');
  assert.deepEqual(manifest.requiredCapabilities, ['toSeat']);
  assert.equal(manifest.lateJoin, 'spectator');
  assert.ok(manifest.sessionConfig.fields.length >= 6);
  assert.deepEqual(manifest.sessionConfig.seatOptions.map((field) => field.key), ['difficulty']);
  assert.deepEqual(validateJson({ ...manifest, oldAbi: 'GameModule' }, manifestSchema, manifestSchema).some((error) => error.includes('extra field')), true);
  const bad = structuredClone(manifest);
  bad.reference.entry = '../secret.txt';
  assert.ok(validateJson(bad, manifestSchema, manifestSchema).length > 0);
});
