import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createWebServer } from '../dist/webroot.js';

const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

async function withServer(root, options, run) {
  const server = createWebServer({ root, modules: [], ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

test('游戏根映射：单文件包按 id 从解包目录取客户端入口', async () => {
  const root = tempDir('bp-webroot-');
  const packDir = tempDir('bp-pack-root-');
  writeFileSync(join(packDir, 'client.js'), 'export default { mount() {} };\n', 'utf8');

  await withServer(root, { gameRoots: new Map([['sample', packDir]]) }, async (base) => {
    const response = await fetch(`${base}/games/sample/client.js`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.match(await response.text(), /mount/);
  });
});

test('游戏根映射：没有映射时仍走 games/<id> 目录', async () => {
  const root = tempDir('bp-webroot-');
  const dir = join(root, 'games', 'fixture-turn', 'dist');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.js'), 'export const ok = true;\n', 'utf8');

  await withServer(root, {}, async (base) => {
    const response = await fetch(`${base}/games/fixture-turn/dist/index.js`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /ok = true/);
  });
});

test('游戏清单：单文件包的 assets 随 /api/games 下发', async () => {
  const root = tempDir('bp-webroot-');
  const fakeModule = {
    id: 'fakepack',
    name: '样本',
    version: '0.1.0',
    entry: 'client.js',
    seats: { min: 1, max: 2 },
    allowSpectate: false,
    soloFill: false,
    roles: ['host'],
    normalizeConfig: () => ({}),
    rulesHashOf: () => 'rules',
    create: () => ({ serialize: () => ({}), handle: () => [], begin: () => [], snapshot: () => ({}) }),
    resume: () => ({ serialize: () => ({}), handle: () => [], begin: () => [], snapshot: () => ({}) }),
  };
  const assets = [{ path: 'client.js', hash: `sha256:${'a'.repeat(64)}`, bytes: 10 }];

  await withServer(root, { modules: [fakeModule], gameAssets: new Map([['fakepack', assets]]) }, async (base) => {
    const data = await (await fetch(`${base}/api/games`)).json();
    assert.equal(data.games[0].id, 'fakepack');
    assert.deepEqual(data.games[0].assets, assets);
  });
});

test('游戏根映射：未知 id 与越界路径都 404', async () => {
  const root = tempDir('bp-webroot-');
  const packDir = tempDir('bp-pack-root-');
  writeFileSync(join(packDir, 'client.js'), 'export default {};\n', 'utf8');

  await withServer(root, { gameRoots: new Map([['sample', packDir]]) }, async (base) => {
    assert.equal((await fetch(`${base}/games/missing/client.js`)).status, 404);
    assert.equal((await fetch(`${base}/games/sample/%2e%2e/secret`)).status, 404);
    assert.equal((await fetch(`${base}/games/not_valid/client.js`)).status, 404);
  });
});
