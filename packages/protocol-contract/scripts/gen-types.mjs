import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const messageSurfaces = ['client-session', 'session-authority', 'local-control'];
const packageSurface = 'game-package';

function readSchema(surface) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'protocol', surface, 'messages.schema.json'), 'utf8'));
}

function buildTypeSchema(schema) {
  const properties = {};
  for (const rule of schema.anyOf) properties[rule.$ref.split('/').pop()] = { $ref: rule.$ref };
  return { $schema: schema.$schema, $defs: schema.$defs, type: 'object', additionalProperties: false, properties };
}

function generate(surface, language, outFile) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-contract-'));
  try {
    const input = path.join(temp, 'schema.json');
    const quickOut = path.join(temp, language === 'python' ? 'types.py' : language === 'csharp' ? 'types.cs' : 'types.ts');
    const source = surface === packageSurface
      ? JSON.parse(fs.readFileSync(path.join(repoRoot, 'protocol', surface, 'manifest.schema.json'), 'utf8'))
      : buildTypeSchema(readSchema(surface));
    fs.writeFileSync(input, JSON.stringify(source, null, 2));
    const cli = path.join(repoRoot, 'node_modules', 'quicktype', 'dist', 'index.js');
    const result = spawnSync(process.execPath, [cli,
      '--src-lang', 'schema', '--lang', language,
      '--top-level', surface === packageSurface ? 'GamePackageManifest' : 'ProtocolTypes',
      '--out', quickOut, input,
    ], { cwd: repoRoot, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`quicktype ${language} ${surface} failed:\n${result.stderr || result.stdout}`);
    const body = fs.readFileSync(quickOut, 'utf8').trimEnd();
    const comment = language === 'python' ? '#' : '//';
    return `${comment} 由 protocol/${surface} 生成；请勿手改。\n${body}\n`;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function main() {
  const check = process.argv.includes('--check');
  const targets = [];
  for (const surface of [...messageSurfaces, packageSurface]) {
    for (const [language, dir, ext] of [['typescript', 'src/generated', 'ts'], ['python', 'python', 'py'], ['csharp', 'csharp', 'cs']]) {
      targets.push([surface, language, path.join(outRoot, dir, `${surface}.${ext}`)]);
    }
  }
  let stale = false;
  for (const [surface, language, target] of targets) {
    const generated = generate(surface, language, target);
    if (check) {
      const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
      if (current !== generated) {
        console.error(`生成物过期：${path.relative(repoRoot, target)}`);
        stale = true;
      }
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, generated);
      console.log(`已生成：${path.relative(repoRoot, target)}`);
    }
  }
  if (check && !stale) console.log('生成物一致');
  if (stale) process.exitCode = 1;
}

main();
