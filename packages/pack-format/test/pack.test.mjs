import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PACK_MAGIC,
  PACK_MARKER,
  extractPack,
  listPackFiles,
  packDirectory,
  readPack,
  readPackSource,
  sha256Hex,
} from '@bp/pack-format';

function tempDir(prefix = 'bp-pack-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function sourceDir(overrides = {}) {
  const dir = tempDir();
  writeFileSync(
    join(dir, 'bpmap.json'),
    JSON.stringify({ id: 'sample', version: '0.1.0', server: 'server.js', client: 'client.js', ...overrides }),
    'utf8',
  );
  writeFileSync(join(dir, 'server.js'), 'export const server = true;\n', 'utf8');
  writeFileSync(join(dir, 'client.js'), 'export default { mount() {} };\n', 'utf8');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'note.txt'), 'hello pack\n', 'utf8');
  return dir;
}

function packOf(dir) {
  const out = join(tempDir(), 'sample.bpmap');
  const manifest = packDirectory(dir, out, readPackSource(dir));
  return { out, manifest, pack: readPack(out) };
}

function entry(path, bytes) {
  return { path, size: bytes.length, sha256: sha256Hex(bytes) };
}

function rawPack(manifest, bodies) {
  const header = Buffer.from(JSON.stringify(manifest), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length, 0);
  return Buffer.concat([Buffer.from(PACK_MAGIC, 'latin1'), length, header, ...bodies]);
}

const serverBytes = Buffer.from('export const server = true;\n');

test('单文件包：mode/apiVersion 进包头，旧包头默认 turn/1', () => {
  const plain = packOf(sourceDir());
  assert.equal(plain.manifest.mode, 'turn');
  assert.equal(plain.manifest.apiVersion, 1);

  const custom = packOf(sourceDir({ mode: 'realtime', apiVersion: 2 }));
  assert.equal(custom.manifest.mode, 'realtime');
  assert.equal(custom.manifest.apiVersion, 2);
  assert.equal(custom.pack.manifest.mode, 'realtime');
  assert.equal(custom.pack.manifest.apiVersion, 2);

  const legacyFile = join(tempDir(), 'legacy.bpmap');
  const legacyManifest = {
    format: 1,
    id: 'legacy',
    version: '0.1.0',
    server: 'server.js',
    files: [entry('server.js', serverBytes)],
  };
  writeFileSync(legacyFile, rawPack(legacyManifest, [serverBytes]));
  const legacy = readPack(legacyFile);
  assert.equal(legacy.manifest.mode, 'turn');
  assert.equal(legacy.manifest.apiVersion, 1);

  assert.throws(() => readPackSource(sourceDir({ mode: '' })), /mode/);
  assert.throws(() => readPackSource(sourceDir({ apiVersion: 0 })), /apiVersion/);
});

test('单文件包：打包、校验、解包往返', () => {
  const dir = sourceDir();
  const { out, manifest, pack } = packOf(dir);

  assert.equal(manifest.id, 'sample');
  assert.equal(manifest.server, 'server.js');
  assert.equal(manifest.client, 'client.js');
  assert.ok(manifest.files.some((file) => file.path === 'server.js'));
  assert.ok(manifest.files.some((file) => file.path === 'assets/note.txt'));
  assert.ok(!manifest.files.some((file) => file.path === 'bpmap.json'), '源清单不能进包');
  assert.deepEqual(
    pack.manifest.files.map((file) => file.path),
    [...pack.manifest.files.map((file) => file.path)].sort(),
    '包内文件按路径排序，便于稳定包哈希',
  );
  assert.equal(pack.packageHash.length, 64);

  const cache = tempDir('bp-cache-');
  const first = extractPack(pack, cache);
  assert.equal(first.reused, false);
  assert.equal(readFileSync(join(first.dir, 'server.js'), 'utf8'), 'export const server = true;\n');
  assert.equal(readFileSync(join(first.dir, 'assets', 'note.txt'), 'utf8'), 'hello pack\n');
  assert.ok(existsSync(join(first.dir, PACK_MARKER)));

  const second = extractPack(pack, cache);
  assert.equal(second.reused, true);
  assert.equal(second.dir, first.dir);
});

test('单文件包：文件段被改一个字节就拒绝', () => {
  const { out, pack } = packOf(sourceDir());
  const raw = readFileSync(out);
  const headerLength = raw.readUInt32LE(PACK_MAGIC.length);
  const dataStart = PACK_MAGIC.length + 4 + headerLength;
  const index = pack.manifest.files.findIndex((file) => file.path === 'server.js');
  const offset = dataStart + pack.manifest.files.slice(0, index).reduce((sum, file) => sum + file.size, 0);
  raw[offset] ^= 0xff;
  writeFileSync(out, raw);
  assert.throws(() => readPack(out), /文件校验失败/);
});

test('单文件包：魔数、长度、JSON、包尾都挡得住', () => {
  const dir = tempDir();
  const badMagic = join(dir, 'magic.bpmap');
  writeFileSync(badMagic, Buffer.concat([Buffer.from('NOPE\n', 'latin1'), Buffer.alloc(8)]));
  assert.throws(() => readPack(badMagic), /魔数不对/);

  const short = join(dir, 'short.bpmap');
  writeFileSync(short, 'nope');
  assert.throws(() => readPack(short), /文件太短/);

  const zeroHeader = join(dir, 'zero.bpmap');
  writeFileSync(zeroHeader, Buffer.concat([Buffer.from(PACK_MAGIC, 'latin1'), Buffer.alloc(4)]));
  assert.throws(() => readPack(zeroHeader), /包头长度不合法/);

  const badJson = join(dir, 'json.bpmap');
  const broken = Buffer.from('{');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(broken.length, 0);
  writeFileSync(badJson, Buffer.concat([Buffer.from(PACK_MAGIC, 'latin1'), length, broken]));
  assert.throws(() => readPack(badJson), /包头不是合法 JSON/);

  const good = rawPack(
    { format: 1, id: 'sample', version: '0.1.0', server: 'server.js', files: [entry('server.js', serverBytes)] },
    [serverBytes],
  );
  const trailing = join(dir, 'trailing.bpmap');
  writeFileSync(trailing, Buffer.concat([good, Buffer.from('x')]));
  assert.throws(() => readPack(trailing), /包尾还有未声明/);
});

test('单文件包：路径穿越、绝对路径、保留名都拒绝', () => {
  const dir = tempDir();
  for (const [name, badPath] of [
    ['traversal', '../evil.js'],
    ['absolute', '/evil.js'],
    ['drive', 'C:/evil.js'],
    ['backslash', 'assets\\evil.js'],
    ['reserved', PACK_MARKER],
  ]) {
    const file = join(dir, `${name}.bpmap`);
    const manifest = { format: 1, id: 'sample', version: '0.1.0', server: badPath, files: [] };
    writeFileSync(file, rawPack(manifest, []));
    assert.throws(() => readPack(file), /路径|保留名/, name);
  }
});

test('单文件包：重复路径、缺入口、坏哈希、尺寸不符都拒绝', () => {
  const dir = tempDir();
  const duplicate = join(dir, 'duplicate.bpmap');
  writeFileSync(
    duplicate,
    rawPack(
      {
        format: 1,
        id: 'sample',
        version: '0.1.0',
        server: 'server.js',
        files: [entry('server.js', serverBytes), entry('Server.js', serverBytes)],
      },
      [serverBytes, serverBytes],
    ),
  );
  assert.throws(() => readPack(duplicate), /路径重复/);

  const missing = join(dir, 'missing.bpmap');
  writeFileSync(
    missing,
    rawPack(
      { format: 1, id: 'sample', version: '0.1.0', server: 'server.js', files: [entry('other.js', serverBytes)] },
      [serverBytes],
    ),
  );
  assert.throws(() => readPack(missing), /服务端入口不在文件清单里/);

  const badHash = join(dir, 'hash.bpmap');
  writeFileSync(
    badHash,
    rawPack(
      {
        format: 1,
        id: 'sample',
        version: '0.1.0',
        server: 'server.js',
        files: [{ path: 'server.js', size: serverBytes.length, sha256: '0'.repeat(64) }],
      },
      [serverBytes],
    ),
  );
  assert.throws(() => readPack(badHash), /文件校验失败/);

  const truncated = join(dir, 'truncated.bpmap');
  writeFileSync(
    truncated,
    rawPack(
      {
        format: 1,
        id: 'sample',
        version: '0.1.0',
        server: 'server.js',
        files: [{ path: 'server.js', size: serverBytes.length + 5, sha256: sha256Hex(serverBytes) }],
      },
      [serverBytes],
    ),
  );
  assert.throws(() => readPack(truncated), /文件段超出包尾/);
});

test('单文件包：源清单校验与入口缺失', () => {
  const badId = sourceDir({ id: 'Bad ID' });
  assert.throws(() => readPackSource(badId), /id 不合法/);

  const missing = sourceDir();
  rmSync(join(missing, 'server.js'));
  assert.throws(() => packDirectory(missing, join(tempDir(), 'x.bpmap'), readPackSource(missing)), /服务端入口不存在/);
});

test('单文件包：缓存里多出未声明文件也会重新解包', () => {
  const { pack } = packOf(sourceDir());
  const cache = tempDir('bp-cache-');
  const first = extractPack(pack, cache);
  writeFileSync(join(first.dir, 'extra.js'), 'not in pack', 'utf8');

  const second = extractPack(pack, cache);
  assert.equal(second.reused, false);
  assert.equal(existsSync(join(second.dir, 'extra.js')), false);
});

test('单文件包：缓存被改后会重新解包，旧目录保留现场', () => {
  const { pack } = packOf(sourceDir());
  const cache = tempDir('bp-cache-');
  const first = extractPack(pack, cache);
  writeFileSync(join(first.dir, 'server.js'), 'tampered', 'utf8');

  const second = extractPack(pack, cache);
  assert.equal(second.reused, false);
  assert.equal(readFileSync(join(second.dir, 'server.js'), 'utf8'), 'export const server = true;\n');
  const parent = join(cache, 'sample');
  assert.ok(readdirSync(parent).some((name) => name.includes('.broken-')), '旧目录不静默删除');
});

test('单文件包：只扫描 games 顶层的 .bpmap 文件', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'a.bpmap'), '');
  writeFileSync(join(dir, 'b.BPMAP'), '');
  writeFileSync(join(dir, 'c.txt'), '');
  mkdirSync(join(dir, 'nested'));
  writeFileSync(join(dir, 'nested', 'd.bpmap'), '');
  assert.deepEqual(
    listPackFiles(dir).map((file) => basename(file)),
    ['a.bpmap', 'b.BPMAP'],
  );
});

test('单文件包：可给读包设置更小的体积上限', () => {
  const { out } = packOf(sourceDir());
  assert.throws(() => readPack(out, { maxTotalBytes: 1 }), /包体积超过上限/);
});
