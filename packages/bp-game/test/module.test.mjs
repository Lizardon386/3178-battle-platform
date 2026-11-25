import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPackage } from '@bp/game-package';
import { buildGamePackage } from '@lizardon386/bp-game';

const referenceRoot = fileURLToPath(new URL('../../../examples/reference-duel', import.meta.url));

test('module 模型：不把运行库打进包，入口导出 createAuthority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-module-build-'));
  const outFile = join(root, 'reference-module.bpkg');
  try {
    const built = await buildGamePackage({
      root: referenceRoot,
      outFile,
      stageDir: join(root, 'stage'),
      authorityModel: 'module',
    });
    assert.equal(built.manifest.authorityModel, 'module');
    const pack = readPackage(outFile);
    const authority = pack.files.find((file) => file.path === 'authority/index.js');
    assert.ok(authority);
    const text = authority.bytes.toString('utf8');
    assert.match(text, /createAuthority/);
    assert.doesNotMatch(text, /class AuthorityRuntime/);
    assert.doesNotMatch(text, /readBootFrame/);
    assert.ok(authority.bytes.length < 120_000, `module Authority 体积异常：${authority.bytes.length}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('process 模型：仍打包自运行入口', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-process-build-'));
  const outFile = join(root, 'reference-process.bpkg');
  try {
    const built = await buildGamePackage({
      root: referenceRoot,
      outFile,
      stageDir: join(root, 'stage'),
      authoritySource: join(referenceRoot, 'src', 'authority', 'process.ts'),
      authorityModel: 'process',
    });
    assert.equal(built.manifest.authorityModel, 'process');
    const pack = readPackage(outFile);
    const authority = pack.files.find((file) => file.path === 'authority/index.js');
    assert.ok(authority);
    assert.match(authority.bytes.toString('utf8'), /readBootFrame|authorityReady/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
