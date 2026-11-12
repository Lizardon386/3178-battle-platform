import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateJson } from '../dist/protocol-v0/schema-validator.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const specDir = path.join(repoRoot, 'protocol/v0');
const schema = JSON.parse(fs.readFileSync(path.join(specDir, 'messages.schema.json'), 'utf8'));
const golden = JSON.parse(fs.readFileSync(path.join(specDir, 'golden/messages.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(specDir, 'catalog.json'), 'utf8'));
const enriched = golden.map((entry) => ({
  ...entry,
  schema: catalog.messages.find((message) => message.from === entry.from && message.to === entry.to && message.type === entry.type).schema,
}));

test('协议 v0 生成物与 schema/catalog 无漂移', () => {
  const script = path.join(repoRoot, 'tools/testkit/scripts/gen-v0-types.mjs');
  const result = spawnSync(process.execPath, [script, '--check'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /生成物一致/);
});

test('TS → Python → TS：41 条 golden 经生成转换类逐条互解', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-v0-interop-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const input = path.join(temp, 'from-ts.json');
  const output = path.join(temp, 'to-ts.json');
  fs.writeFileSync(input, JSON.stringify(enriched), 'utf8');
  const script = path.join(repoRoot, 'tools/testkit/fixtures/protocol-v0/roundtrip.py');
  const result = spawnSync('python', ['-I', '-X', 'utf8', script, input, output], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /41 messages/);
  const returned = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(returned.length, golden.length);
  const byName = new Map(enriched.map((entry) => [entry.name, entry]));
  for (const item of returned) {
    const original = byName.get(item.name);
    assert.ok(original, item.name);
    assert.deepEqual(item.value, original.value, item.name);
    const rule = { $ref: `#/$defs/${original.schema}` };
    assert.deepEqual(validateJson(item.value, rule, schema), [], item.name);
  }
});

test('四个方向联合覆盖 catalog，TS/Python 均生成同名联合', () => {
  const ts = fs.readFileSync(path.join(repoRoot, 'tools/testkit/src/protocol-v0/generated/messages.ts'), 'utf8');
  const py = fs.readFileSync(path.join(repoRoot, 'tools/testkit/fixtures/protocol-v0/messages.py'), 'utf8');
  for (const name of ['ClientToPlatformMessage', 'PlatformToClientMessage', 'PlatformToAuthorityMessage', 'AuthorityToPlatformMessage']) {
    assert.ok(ts.includes(`export type ${name} =`), name);
    assert.ok(py.includes(`${name} =`), name);
  }
  assert.match(ts, /export type ProtocolMessage = ClientToPlatformMessage/);
  assert.match(py, /ProtocolMessage = ClientToPlatformMessage/);
});
