import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../protocol/v0');
const read = (name) => JSON.parse(fs.readFileSync(path.join(rootDir, name), 'utf8'));
const schema = read('messages.schema.json');
const catalog = read('catalog.json');

function typeMatches(value, type) {
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  return false;
}

/* 只实现本 spec 使用的 JSON Schema 子集；遇到未知关键字直接失败，不能静默放行。 */
function validate(value, rule, root, at = '$') {
  if (!rule || Object.keys(rule).length === 0) return [];
  if (rule.$ref) {
    const name = rule.$ref.replace('#$defs/', '');
    if (!root.$defs[name]) return [`${at}: unknown ref ${rule.$ref}`];
    return validate(value, root.$defs[name], root, at);
  }
  const errors = [];
  const known = new Set(['$schema','$id','title','$defs','$ref','const','enum','type','required','properties','additionalProperties','anyOf','items','minItems','maxItems','uniqueItems','minLength','maxLength','pattern','minimum','maximum']);
  for (const key of Object.keys(rule)) if (!known.has(key)) errors.push(`${at}: unsupported schema keyword ${key}`);
  if (rule.const !== undefined && value !== rule.const) errors.push(`${at}: expected const ${rule.const}`);
  if (rule.enum && !rule.enum.includes(value)) errors.push(`${at}: expected enum ${rule.enum.join('|')}`);
  if (rule.type) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!types.some((type) => typeMatches(value, type))) {
      errors.push(`${at}: expected type ${types.join('|')}`);
      return errors;
    }
  }
  if (rule.anyOf) {
    const matched = rule.anyOf.some((branch) => validate(value, branch, root, at).length === 0);
    if (!matched) errors.push(`${at}: no anyOf branch matched`);
  }
  if (typeof value === 'string') {
    const length = Array.from(value).length;
    if (rule.minLength !== undefined && length < rule.minLength) errors.push(`${at}: string too short`);
    if (rule.maxLength !== undefined && length > rule.maxLength) errors.push(`${at}: string too long`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${at}: pattern ${rule.pattern} mismatch`);
  }
  if (typeof value === 'number') {
    if (rule.minimum !== undefined && value < rule.minimum) errors.push(`${at}: below minimum`);
    if (rule.maximum !== undefined && value > rule.maximum) errors.push(`${at}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) errors.push(`${at}: too few items`);
    if (rule.maxItems !== undefined && value.length > rule.maxItems) errors.push(`${at}: too many items`);
    if (rule.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${at}: items not unique`);
    if (rule.items) value.forEach((item, index) => errors.push(...validate(item, rule.items, root, `${at}[${index}]`)));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of rule.required || []) if (!Object.hasOwn(value, key)) errors.push(`${at}: missing ${key}`);
    const properties = rule.properties || {};
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) errors.push(...validate(item, properties[key], root, `${at}.${key}`));
      else if (rule.additionalProperties === false) errors.push(`${at}: extra field ${key}`);
      else if (rule.additionalProperties && typeof rule.additionalProperties === 'object') errors.push(...validate(item, rule.additionalProperties, root, `${at}.${key}`));
    }
  }
  return errors;
}

function assertValid(value) {
  assert.deepEqual(validate(value, schema, schema), []);
}
function assertInvalid(value, includes, definition) {
  const rule = definition ? { $ref: `#$defs/${definition}` } : schema;
  const errors = validate(value, rule, schema);
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
  const rootRefs = new Set(schema.anyOf.map((rule) => rule.$ref.replace('#$defs/', '')));
  assert.deepEqual(rootRefs, new Set(catalog.messages.map((message) => message.schema)));
});

test('S1 examples：所有示例都通过根 schema', () => {
  const dir = path.join(rootDir, 'examples');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
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
  for (const code of ['NOTREADY', 'GAMEFAILED', 'HANDOFF', 'FORBIDDEN']) assert.ok(codes.includes(code));
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
