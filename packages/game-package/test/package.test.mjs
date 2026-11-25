import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  GameRegistry,
  PackageError,
  buildPackage,
  extractPackage,
  openGameRegistry,
  readPackage,
  validateManifest,
} from '@bp/game-package';

const tempDirs = [];
function tempDir(prefix = 'bp-bpkg-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const manifest = (overrides = {}) => ({
  id: 'fixture-game',
  name: '夹具游戏',
  version: '1.0.0',
  platformRequirements: { protocolVersion: 1, minPlayers: 2, maxPlayers: 4, allowSpectate: true },
  entryPoints: { authority: 'authority/index.js', web: 'web/index.html' },
  sessionConfig: {
    fields: [
      { key: 'rounds', type: 'integer', label: '回合数', default: 3, min: 1, max: 9 },
      { key: 'speed', type: 'enum', label: '节奏', default: 'fast', options: [{ value: 'fast', label: '快' }] },
    ],
  },
  reference: { entry: 'reference.json' },
  ...overrides,
});

function packageSource(overrides = {}) {
  const dir = tempDir();
  mkdirSync(join(dir, 'authority'), { recursive: true });
  mkdirSync(join(dir, 'web'), { recursive: true });
  writeFileSync(join(dir, 'authority', 'index.js'), 'module.exports = {};\n');
  writeFileSync(join(dir, 'web', 'index.html'), '<!doctype html><title>fixture</title>\n');
  writeFileSync(join(dir, 'web', 'main.js'), 'console.log("fixture");\n');
  writeFileSync(join(dir, 'reference.json'), '{"name":"fixture"}\n');
  return { dir, manifest: manifest(overrides) };
}

test('清单 golden：color-duel 通过校验', () => {
  const golden = JSON.parse(readFileSync(new URL('../../../protocol/game-package/golden/manifest-color-duel.json', import.meta.url), 'utf8'));
  const parsed = validateManifest(golden);
  assert.equal(parsed.id, 'color-duel');
  assert.equal(parsed.sessionConfig.fields.length, 6);
  assert.equal(parsed.sessionConfig.seatOptions[0].roles[0], 'ai');
});

test('清单校验拒绝未知字段与错误默认值', () => {
  assert.throws(() => validateManifest(manifest({ extra: true })), /未知字段/);
  assert.throws(
    () => validateManifest(manifest({
      sessionConfig: { fields: [{ key: 'flag', type: 'boolean', label: '开关', default: 'yes' }] },
    })),
    /布尔值/,
  );
  assert.throws(
    () => validateManifest(manifest({
      sessionConfig: { fields: [{ key: 'a', type: 'boolean', label: 'A', default: true, dependsOn: 'missing' }] },
    })),
    /依赖了不存在的键/,
  );
});

test('构建、读取、解包并复用缓存', () => {
  const { dir, manifest: game } = packageSource();
  const outFile = join(tempDir(), 'fixture.bpkg');
  const built = buildPackage({ root: dir, manifest: game, outFile });
  assert.equal(built.files.length, 4);
  assert.deepEqual(built.files.map((file) => file.path), [
    'authority/index.js',
    'reference.json',
    'web/index.html',
    'web/main.js',
  ]);

  const loaded = readPackage(outFile);
  assert.equal(loaded.packageHash, built.packageHash);
  assert.equal(loaded.manifest.id, 'fixture-game');
  assert.equal(loaded.files.length, 4);

  const cacheRoot = join(tempDir(), 'cache');
  const first = extractPackage(loaded, cacheRoot);
  assert.equal(first.reused, false);
  assert.equal(readFileSync(join(first.dir, 'web', 'index.html'), 'utf8').includes('fixture'), true);
  const second = extractPackage(readPackage(outFile), cacheRoot);
  assert.equal(second.reused, true);
  assert.equal(second.dir, first.dir);
});

test('构建拒绝缺失入口、路径穿越与大小写重复', () => {
  const { dir, manifest: game } = packageSource();
  rmSync(join(dir, 'authority', 'index.js'));
  assert.throws(() => buildPackage({ root: dir, manifest: game, outFile: join(tempDir(), 'x.bpkg') }), /不在文件清单里/);

  const traversal = packageSource({ entryPoints: { authority: '../evil.js', web: 'web/index.html' } });
  assert.throws(
    () => buildPackage({ root: traversal.dir, manifest: traversal.manifest, outFile: join(tempDir(), 'x.bpkg') }),
    /不合法/,
  );

  if (process.platform !== 'win32') {
    const duplicate = packageSource();
    writeFileSync(join(duplicate.dir, 'web', 'MAIN.js'), 'duplicate\n');
    assert.throws(
      () => buildPackage({ root: duplicate.dir, manifest: duplicate.manifest, outFile: join(tempDir(), 'x.bpkg') }),
      /不区分大小写/,
    );
  }

  // Windows 文件系统放不下仅大小写不同的两个文件，包头层的重复检查用构造包验证。
  const header = Buffer.from(JSON.stringify({
    format: 1,
    manifest: manifest(),
    files: [
      { path: 'authority/index.js', sha256: '0'.repeat(64), bytes: 0 },
      { path: 'AUTHORITY/index.js', sha256: '0'.repeat(64), bytes: 0 },
    ],
  }));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length, 0);
  const crafted = join(tempDir(), 'duplicate-header.bpkg');
  writeFileSync(crafted, Buffer.concat([Buffer.from('BPKG1\n', 'latin1'), length, header]));
  assert.throws(() => readPackage(crafted), /不区分大小写/);
});

test('读取拒绝篡改、尾部多余字节与旧 .bpmap', () => {
  const { dir, manifest: game } = packageSource();
  const outFile = join(tempDir(), 'fixture.bpkg');
  buildPackage({ root: dir, manifest: game, outFile });

  const original = readFileSync(outFile);
  const tampered = Buffer.from(original);
  tampered[tampered.length - 1] ^= 0xff;
  const tamperedFile = join(tempDir(), 'tampered.bpkg');
  writeFileSync(tamperedFile, tampered);
  assert.throws(() => readPackage(tamperedFile), /文件校验失败/);

  const extended = Buffer.concat([original, Buffer.from('extra')]);
  const extendedFile = join(tempDir(), 'extended.bpkg');
  writeFileSync(extendedFile, extended);
  assert.throws(() => readPackage(extendedFile), /未声明的/);

  const legacy = join(tempDir(), 'legacy.bpmap');
  writeFileSync(legacy, 'BPMAP1\n' + 'x'.repeat(16));
  assert.throws(() => readPackage(legacy), /旧 \.bpmap/);
});

test('注册表：精确版本、最高版本、重复包与坏包', () => {
  const source = packageSource();
  const dir = tempDir();
  const v1 = join(dir, 'fixture-1.0.0.bpkg');
  const v2 = join(dir, 'fixture-2.0.0.bpkg');
  buildPackage({ root: source.dir, manifest: source.manifest, outFile: v1 });
  buildPackage({ root: source.dir, manifest: manifest({ version: '2.0.0' }), outFile: v2 });

  const cacheRoot = join(tempDir(), 'cache');
  const registry = openGameRegistry({ packages: [v1, v2], cacheRoot });
  assert.equal(registry.size, 2);
  assert.equal(registry.resolve('fixture-game', '1.0.0').manifest.version, '1.0.0');
  assert.equal(registry.resolve('fixture-game').manifest.version, '2.0.0');
  assert.equal(registry.resolve('fixture-game', '9.9.9'), null);
  assert.equal(registry.resolve('missing-game'), null);
  assert.deepEqual(registry.list(), [{ id: 'fixture-game', name: '夹具游戏', versions: ['1.0.0', '2.0.0'] }]);

  assert.throws(() => new GameRegistry([
    registry.resolve('fixture-game', '1.0.0'),
    registry.resolve('fixture-game', '1.0.0'),
  ]), /重复注册/);

  const broken = join(tempDir(), 'broken.bpkg');
  writeFileSync(broken, 'not a package');
  assert.throws(() => openGameRegistry({ packages: [broken], cacheRoot }), /不是游戏包/);
});

test('签名信任链：强制签名时只接受可信公钥', () => {
  const source = packageSource();
  const outFile = join(tempDir(), 'signed.bpkg');
  buildPackage({ root: source.dir, manifest: source.manifest, outFile });
  const pack = readPackage(outFile);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const signature = {
    algorithm: 'ed25519',
    value: sign(null, Buffer.from(pack.packageHash, 'utf8'), privateKey).toString('base64'),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  const sigFile = `${outFile}.sig`;
  writeFileSync(sigFile, JSON.stringify(signature));
  const cacheRoot = join(tempDir(), 'cache');

  const trusted = openGameRegistry({
    packages: [outFile],
    cacheRoot,
    trust: { requireSignature: true, trustedKeys: [publicPem] },
  });
  assert.ok(trusted.resolve('fixture-game', '1.0.0'));

  const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  assert.throws(
    () => openGameRegistry({ packages: [outFile], cacheRoot, trust: { requireSignature: true, trustedKeys: [other] } }),
    /签名校验失败/,
  );
  assert.throws(
    () => openGameRegistry({ packages: [outFile], cacheRoot, trust: { requireSignature: true } }),
    /没有配置可信公钥/,
  );
  rmSync(sigFile);
  assert.throws(
    () => openGameRegistry({ packages: [outFile], cacheRoot, trust: { requireSignature: true, trustedKeys: [publicPem] } }),
    /缺少或读不到签名文件/,
  );
});

test('注册表解析出 Authority 入口与 Web 根', () => {
  const source = packageSource();
  const outFile = join(tempDir(), 'fixture.bpkg');
  buildPackage({ root: source.dir, manifest: source.manifest, outFile });
  const registry = openGameRegistry({ packages: [outFile], cacheRoot: join(tempDir(), 'cache') });
  const game = registry.resolve('fixture-game', '1.0.0');
  assert.ok(game);
  assert.ok(game.authorityEntry.endsWith(join('authority', 'index.js')));
  assert.ok(game.web);
  assert.ok(game.web.root.endsWith(join('fixture-game', game.packageHash, 'web')));
  assert.equal(game.web.entry, 'index.html');

  const noWeb = packageSource({ entryPoints: { authority: 'authority/index.js' } });
  const noWebFile = join(tempDir(), 'noweb.bpkg');
  buildPackage({ root: noWeb.dir, manifest: noWeb.manifest, outFile: noWebFile });
  const noweb = openGameRegistry({ packages: [noWebFile], cacheRoot: join(tempDir(), 'cache2') })
    .resolve('fixture-game', '1.0.0');
  assert.equal(noweb.web, null);
});
