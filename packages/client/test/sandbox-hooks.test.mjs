import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGameClientSource } from '../dist/module-loader.js';
import { sha256Hex as sha256HexFallback } from '../dist/sha256.js';

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

async function digest(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

test('客户端沙箱：iframe 只给 allow-scripts，不给 same-origin', () => {
  const loader = stripComments(read('../src/module-loader.ts'));
  assert.match(loader, /setAttribute\('sandbox', 'allow-scripts'\)/);
  assert.doesNotMatch(loader, /allow-same-origin/);
  assert.match(loader, /chat-history/);
  assert.match(loader, /sandboxChatText/);

  const sandbox = read('../public/game-sandbox.html');
  assert.match(sandbox, /addEventListener\('message'/);
  assert.match(sandbox, /parent\.postMessage/);
  assert.match(sandbox, /bp:chat-history/);
  assert.match(sandbox, /bp:chat/);
  assert.match(sandbox, /bp:room/);
  assert.match(sandbox, /data\.type === 'chat'/);
  assert.doesNotMatch(sandbox, /localStorage|document\.cookie/);
});

test('客户端沙箱：app 挂载走沙箱，离开房间时卸载', () => {
  const app = read('../src/app.ts');
  assert.match(app, /sandboxedClient/);
  assert.match(app, /loadGameClientSource/);
  assert.match(app, /this\.attachSeq \+= 1/);
  assert.match(app, /this\.client\?\.unmount\?\.\(host\)/);
});

test('客户端源码：哈希对上才执行，对不上拒绝', async () => {
  const source = 'export default { mount() {} };\n';
  const goodHash = `sha256:${await digest(source)}`;
  const manifest = {
    id: 'sample',
    name: '样本',
    version: '0.1.0',
    entry: 'client.js',
    assets: [{ path: 'client.js', hash: goodHash }],
  };
  const fetchImpl = async () => new Response(source, { status: 200 });

  const good = await loadGameClientSource(manifest, 'http://127.0.0.1:3178', fetchImpl);
  assert.equal(good.ok, true);
  assert.equal(good.verified, true);
  assert.equal(good.baseUrl, 'http://127.0.0.1:3178/games/sample/');

  const bad = await loadGameClientSource(
    { ...manifest, assets: [{ path: 'client.js', hash: `sha256:${'0'.repeat(64)}` }] },
    'http://127.0.0.1:3178',
    fetchImpl,
  );
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /校验不一致/);
});

test('客户端源码：入口 404 返回占位提示', async () => {
  const manifest = { id: 'sample', name: '样本', version: '0.1.0', entry: 'client.js' };
  const result = await loadGameClientSource(manifest, 'http://127.0.0.1:3178', async () => new Response('', { status: 404 }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /没带自己的界面/);
  assert.match(result.reason, /404/);
});

test('纯 JS SHA-256：标准向量与 Web Crypto 一致', async () => {
  const vectors = ['', 'abc', '中文源码\n', 'x'.repeat(1000)];
  for (const text of vectors) {
    assert.equal(sha256HexFallback(new TextEncoder().encode(text)), await digest(text), text.slice(0, 20));
  }
});

test('客户端源码：没有 Web Crypto 时仍能校验并通过', async () => {
  const source = 'export default { mount() {} };\n';
  const hash = `sha256:${await digest(source)}`;
  const manifest = {
    id: 'sample',
    name: '样本',
    version: '0.1.0',
    entry: 'client.js',
    assets: [{ path: 'client.js', hash }],
  };
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    const result = await loadGameClientSource(manifest, 'http://192.168.1.20:3000', async () => new Response(source, { status: 200 }));
    assert.equal(result.ok, true);
    assert.equal(result.verified, true);
  } finally {
    Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true });
  }
});
