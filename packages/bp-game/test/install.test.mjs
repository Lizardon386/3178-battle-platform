import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPackage } from '@bp/game-package';
import {
  buildGamePackage,
  initGame,
  installPackage,
  listInstalled,
  signPackage,
  uninstallPackage,
} from '@lizardon386/bp-game';

const manifest = {
  id: 'install-game',
  name: '安装夹具',
  version: '1.0.0',
  platformRequirements: { protocolVersion: 1, minPlayers: 2, maxPlayers: 2 },
  entryPoints: { authority: 'authority.js', web: 'web/index.html' },
  sessionConfig: { fields: [] },
  reference: { entry: 'reference.json' },
};

async function createPackage(root) {
  const source = join(root, 'source');
  await mkdir(join(source, 'web'), { recursive: true });
  await writeFile(join(source, 'authority.js'), 'console.log("install");\n');
  await writeFile(join(source, 'web', 'index.html'), '<!doctype html><title>install</title>\n');
  await writeFile(join(source, 'reference.json'), '{"name":"install"}\n');
  const outFile = join(root, 'install-game.bpkg');
  buildPackage({ root: source, manifest, outFile });
  return outFile;
}

test('安装/列表/覆盖/卸载', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-install-'));
  const gamesDir = join(root, 'games');
  try {
    const outFile = await createPackage(root);
    const installed = await installPackage({ file: outFile, gamesDir });
    assert.equal(installed.id, 'install-game');
    assert.equal(installed.file, join(gamesDir, 'install-game-1.0.0.bpkg'));

    const list = await listInstalled(gamesDir);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'install-game');
    assert.equal(list[0].signed, false);

    await assert.rejects(() => installPackage({ file: outFile, gamesDir }), /已安装同名包/);
    await installPackage({ file: outFile, gamesDir, force: true });

    const removed = await uninstallPackage(gamesDir, 'install-game@1.0.0');
    assert.equal(removed, installed.file);
    assert.deepEqual(await listInstalled(gamesDir), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('安装：可信公钥强制签名，错误公钥/缺签名拒绝', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-install-signed-'));
  const gamesDir = join(root, 'games');
  try {
    const outFile = await createPackage(root);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const signature = signPackage(outFile, privatePem);
    await writeFile(`${outFile}.sig`, JSON.stringify(signature));

    const installed = await installPackage({ file: outFile, gamesDir, trustedKeys: [publicPem] });
    assert.equal(installed.signed, true);
    assert.equal(installed.signatureValid, true);
    const list = await listInstalled(gamesDir);
    assert.equal(list[0].signatureValid, true);

    const otherKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await rm(gamesDir, { recursive: true, force: true });
    await assert.rejects(
      () => installPackage({ file: outFile, gamesDir, trustedKeys: [otherKey] }),
      /签名校验失败/,
    );

    await rm(`${outFile}.sig`);
    await assert.rejects(
      () => installPackage({ file: outFile, gamesDir, trustedKeys: [publicPem] }),
      /缺少签名文件/,
    );

    await writeFile(`${outFile}.sig`, JSON.stringify({ ...signature, value: signature.value.slice(0, -4) + 'AAAA' }));
    await assert.rejects(() => installPackage({ file: outFile, gamesDir }), /签名与包内容不匹配/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('init 生成的模板可直接安装', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-install-template-'));
  const project = join(root, 'project');
  const gamesDir = join(root, 'games');
  try {
    await initGame({ dir: project, id: 'install-template' });
    const outFile = join(root, 'template.bpkg');
    await buildGamePackage({ root: project, outFile, stageDir: join(root, 'stage') });
    const installed = await installPackage({ file: outFile, gamesDir });
    assert.equal(installed.id, 'install-template');
    const bytes = await readFile(join(gamesDir, 'install-template-0.1.0.bpkg'));
    assert.equal(bytes.subarray(0, 6).toString('latin1'), 'BPKG1\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
