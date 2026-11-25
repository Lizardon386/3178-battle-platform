import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyUpgrade, checkInstall, rollbackUpgrade } from '../upgrade-lib.mjs';

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function writePackage(dir, version, marker) {
  await mkdir(dir, { recursive: true });
  const contents = {
    '3178.exe': `app-${version}`,
    'bp-supervisor.exe': `sup-${version}`,
    'marker.txt': marker,
  };
  const files = [];
  for (const [path, text] of Object.entries(contents)) {
    const bytes = Buffer.from(text, 'utf8');
    await writeFile(join(dir, path), bytes);
    files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  await writeFile(join(dir, 'build-manifest.json'), `${JSON.stringify({
    product: '3178', version, commit: `commit-${version}`, files,
  }, null, 2)}\n`);
}

const readMarker = (dir) => readFile(join(dir, 'marker.txt'), 'utf8');

test('升级：校验源包、备份旧目录、切换新目录并可回滚', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-upgrade-'));
  const target = join(root, '3178');
  const source = join(root, 'new');
  const now = Date.UTC(2026, 0, 2, 3, 4, 5);
  try {
    await writePackage(target, '1.0.0', 'old');
    await writePackage(source, '1.1.0', 'new');

    const applied = await applyUpgrade({ target, source, now });
    assert.equal(await readMarker(target), 'new');
    assert.equal(await readMarker(applied.backup), 'old');
    const record = JSON.parse(await readFile(join(target, 'upgrade.json'), 'utf8'));
    assert.equal(record.version, '1.1.0');
    assert.equal(record.previous, applied.backup);
    assert.equal((await checkInstall(target)).version, '1.1.0');

    const rolled = await rollbackUpgrade({ target, now: now + 1000 });
    assert.equal(await readMarker(target), 'old');
    assert.equal(await readMarker(rolled.failed), 'new');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('升级：源包哈希不符时拒绝，目标不变', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-upgrade-bad-'));
  const target = join(root, '3178');
  const source = join(root, 'new');
  try {
    await writePackage(target, '1.0.0', 'old');
    await writePackage(source, '1.1.0', 'new');
    await writeFile(join(source, 'marker.txt'), 'tampered');
    await assert.rejects(() => applyUpgrade({ target, source }), /文件大小不符|文件哈希不符/);
    assert.equal(await readMarker(target), 'old');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('升级：目标不是已安装目录时拒绝', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-upgrade-missing-'));
  const source = join(root, 'new');
  try {
    await writePackage(source, '1.1.0', 'new');
    await assert.rejects(
      () => applyUpgrade({ target: join(root, 'not-installed'), source }),
      /不是已安装目录/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('回滚：没有 upgrade.json 时退回最近备份目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-upgrade-scan-'));
  const target = join(root, '3178');
  const backup = `${target}.old-20260102T030405`;
  try {
    await writePackage(target, '1.1.0', 'new');
    await writePackage(backup, '1.0.0', 'old');
    const rolled = await rollbackUpgrade({ target, now: Date.UTC(2026, 0, 3) });
    assert.equal(await readMarker(target), 'old');
    assert.match(rolled.failed, /\.failed-/);
    assert.equal(await readMarker(rolled.failed), 'new');
    const siblings = await readdir(root);
    assert.ok(siblings.some((name) => name.startsWith('3178.failed-')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
