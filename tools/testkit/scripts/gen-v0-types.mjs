import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const specDir = path.join(repoRoot, 'protocol/v0');
const schema = JSON.parse(fs.readFileSync(path.join(specDir, 'messages.schema.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(specDir, 'catalog.json'), 'utf8'));

export function buildTypeSchema() {
  const properties = {};
  for (const rule of schema.anyOf) properties[rule.$ref.split('/').pop()] = { $ref: rule.$ref };
  return {
    $schema: schema.$schema,
    $defs: schema.$defs,
    type: 'object',
    additionalProperties: false,
    properties,
  };
}

export function directionUnions(language) {
  const groups = [
    ['ClientToPlatformMessage', 'client', 'platform'],
    ['PlatformToClientMessage', 'platform', 'client'],
    ['PlatformToAuthorityMessage', 'platform', 'authority'],
    ['AuthorityToPlatformMessage', 'authority', 'platform'],
  ];
  const lines = [];
  for (const [name, from, to] of groups) {
    const members = catalog.messages.filter((message) => message.from === from && message.to === to).map((message) => message.schema);
    if (!members.length) throw new Error(`empty direction ${from}->${to}`);
    lines.push(language === 'ts' ? `export type ${name} = ${members.join(' | ')};` : `${name} = ${members.join(' | ')}`);
  }
  const all = groups.map(([name]) => name).join(' | ');
  lines.push(language === 'ts' ? `export type ProtocolMessage = ${all};` : `ProtocolMessage = ${all};`);
  return lines.join('\n\n');
}

function generate(language, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-v0-types-'));
  try {
    const input = path.join(temp, 'types.schema.json');
    const quickOut = path.join(temp, language === 'python' ? 'messages.py' : 'messages.ts');
    fs.writeFileSync(input, JSON.stringify(buildTypeSchema(), null, 2));
    const cli = path.join(repoRoot, 'node_modules', 'quicktype', 'dist', 'index.js');
    const result = spawnSync(process.execPath, [cli,
      '--src-lang', 'schema', '--lang', language,
      '--top-level', 'ProtocolTypes', '--out', quickOut, input,
    ], { cwd: repoRoot, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`quicktype ${language} failed:\n${result.stderr || result.stdout}`);
    const comment = language === 'python' ? '#' : '//';
    const body = fs.readFileSync(quickOut, 'utf8').trimEnd();
    return `${comment} 由 protocol/v0/messages.schema.json + catalog.json 生成；请勿手改。\n${body}\n\n${directionUnions(language === 'python' ? 'python' : 'ts')}\n`;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function main() {
  const check = process.argv.includes('--check');
  const targets = [
    ['typescript', path.join(repoRoot, 'tools/testkit/src/protocol-v0/generated/messages.ts')],
    ['python', path.join(repoRoot, 'tools/testkit/fixtures/protocol-v0/messages.py')],
  ];
  let stale = false;
  for (const [language, target] of targets) {
    const generated = generate(language, target);
    if (check) {
      const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
      if (current !== generated) {
        console.error(`生成物过期：${path.relative(repoRoot, target)}`);
        stale = true;
      } else {
        console.log(`生成物一致：${path.relative(repoRoot, target)}`);
      }
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, generated);
      console.log(`已生成：${path.relative(repoRoot, target)}`);
    }
  }
  if (stale) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
