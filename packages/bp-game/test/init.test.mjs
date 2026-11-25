import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPackage } from '@bp/game-package';
import { buildGamePackage, initGame } from '@lizardon386/bp-game';

test('init：生成模板、拒绝非空目录、可 build 成 .bpkg', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-init-'));
  const dir = join(root, 'tiny-template');
  try {
    const result = await initGame({ dir });
    assert.equal(result.id, 'tiny-template');
    for (const relative of result.files) {
      assert.ok((await stat(join(dir, ...relative.split('/')))).isFile(), relative);
    }
    const manifest = JSON.parse(await readFile(join(dir, 'game.manifest.json'), 'utf8'));
    assert.equal(manifest.entryPoints.authority, 'authority/index.js');
    assert.equal(manifest.entryPoints.web, 'web/index.html');

    await assert.rejects(() => initGame({ dir }), /目录非空/);
    await initGame({ dir, force: true, id: 'tiny-template' });

    const outFile = join(root, 'tiny.bpkg');
    await buildGamePackage({ root: dir, outFile, stageDir: join(root, 'stage') });
    const pack = readPackage(outFile);
    assert.ok(pack.files.some((file) => file.path === 'authority/index.js'));
    assert.ok(pack.files.some((file) => file.path === 'web/index.html'));
    assert.match(
      pack.files.find((file) => file.path === 'authority/index.js').bytes.toString('utf8'),
      /authorityReady/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
