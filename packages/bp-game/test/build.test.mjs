import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPackage } from '@bp/game-package';
import { buildGamePackage, signPackage, verifyPackage } from '@lizardon386/bp-game';

const manifest = {
  id: 'tiny-game',
  name: '微型游戏',
  version: '0.1.0',
  platformRequirements: { protocolVersion: 1, minPlayers: 2, maxPlayers: 2 },
  entryPoints: { authority: 'authority/index.js', web: 'web/index.html' },
  sessionConfig: { fields: [] },
  reference: { entry: 'reference.json' },
};

async function createProject() {
  const root = await mkdtemp(join(tmpdir(), 'bp-bp-game-'));
  await mkdir(join(root, 'src', 'authority'), { recursive: true });
  await mkdir(join(root, 'src', 'web'), { recursive: true });
  await writeFile(join(root, 'game.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(root, 'src', 'authority', 'marker.ts'), 'export const MARKER = "BUNDLED_MARKER_3178";\n');
  await writeFile(
    join(root, 'src', 'authority', 'process.ts'),
    'import { MARKER } from "./marker.js";\nconsole.log(MARKER);\n',
  );
  await writeFile(join(root, 'src', 'web', 'index.html'), '<!doctype html><title>tiny</title>\n');
  await writeFile(join(root, 'src', 'web', 'main.js'), 'console.log("tiny");\n');
  await writeFile(join(root, 'src', 'reference.json'), '{"name":"tiny"}\n');
  return root;
}

test('build：Authority 打成自包含 bundle，Web/参考资料进入包内', async () => {
  const root = await createProject();
  const outFile = join(root, 'out', 'tiny.bpkg');
  const result = await buildGamePackage({ root, outFile, stageDir: join(root, 'out', 'stage') });
  assert.equal(result.manifest.id, 'tiny-game');

  const pack = readPackage(outFile);
  const authority = pack.files.find((file) => file.path === 'authority/index.js');
  assert.ok(authority);
  assert.match(authority.bytes.toString('utf8'), /BUNDLED_MARKER_3178/);
  assert.doesNotMatch(authority.bytes.toString('utf8'), /from ["']\.\/marker/);
  assert.ok(pack.files.some((file) => file.path === 'web/index.html'));
  assert.ok(pack.files.some((file) => file.path === 'web/main.js'));
  assert.ok(pack.files.some((file) => file.path === 'reference.json'));
  assert.ok(pack.files.some((file) => file.path === 'package.json'));
});

test('sign/verify：整包签名可验证，篡改后失败', async () => {
  const root = await createProject();
  const outFile = join(root, 'out', 'tiny.bpkg');
  await buildGamePackage({ root, outFile, stageDir: join(root, 'out', 'stage') });

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const signature = signPackage(outFile, privatePem);
  assert.equal(signature.algorithm, 'ed25519');
  assert.equal(verifyPackage(outFile, signature), true);
  assert.equal(verifyPackage(outFile, signature, publicPem), true);

  const tampered = join(root, 'out', 'tampered.bpkg');
  const bytes = await readFile(outFile);
  bytes[bytes.length - 1] ^= 0xff;
  await writeFile(tampered, bytes);
  assert.throws(() => verifyPackage(tampered, signature), /文件校验失败/);
  assert.equal(verifyPackage(outFile, { ...signature, value: Buffer.from('nope').toString('base64') }), false);
});
