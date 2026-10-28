import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_REFERENCE_TITLE,
  loadGameReference,
  referenceDocumentUrl,
  referenceImageUrl,
  renderReference,
} from '@bp/client/reference.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, '..', 'src', 'reference.ts'), 'utf8');

const manifest = {
  id: 'demo',
  name: '演示',
  version: '0.1.0',
  rulesHash: 'x',
  seats: { min: 1, max: 2 },
  allowSpectate: false,
  soloFill: false,
  roles: ['host', 'player'],
  entry: 'client.js',
  reference: { entry: 'docs/reference.json' },
};

const validDoc = {
  version: 1,
  title: '规则手册',
  groups: [
    {
      id: 'basics',
      title: '基础',
      items: [{ title: '回合', text: '每回合出一张牌。' }],
    },
  ],
};

test('reference：入口与图片路径只接受包内相对路径', () => {
  assert.equal(referenceDocumentUrl('http://host', manifest), 'http://host/games/demo/docs/reference.json');
  assert.equal(referenceDocumentUrl('http://host', { ...manifest, reference: { entry: '../escape.json' } }), null);
  assert.equal(referenceDocumentUrl('http://host', { ...manifest, reference: { entry: 'docs\\reference.json' } }), null);
  assert.equal(referenceImageUrl('http://host', 'demo', 'images/pic one.png'), 'http://host/games/demo/images/pic%20one.png');
  for (const bad of ['../secret.png', '/abs.png', 'a\\b.png', 'a/../../b.png', 'images/note.txt']) {
    assert.equal(referenceImageUrl('http://host', 'demo', bad), null, bad);
  }
});

test('reference：404、坏 JSON 与网络错误都给可读原因', async () => {
  const notFound = await loadGameReference(manifest, 'http://host', async () => ({ ok: false, status: 404, text: async () => '' }));
  assert.equal(notFound.ok, false);
  assert.match(notFound.message, /404/);

  const badJson = await loadGameReference(manifest, 'http://host', async () => ({ ok: true, status: 200, text: async () => '{not json' }));
  assert.equal(badJson.ok, false);
  assert.match(badJson.message, /JSON/);

  const broken = await loadGameReference(manifest, 'http://host', async () => {
    throw new Error('断网');
  });
  assert.equal(broken.ok, false);
  assert.match(broken.message, /断网/);

  const missing = await loadGameReference({ ...manifest, reference: undefined }, 'http://host', async () => {
    throw new Error('不该请求');
  });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /没有提供/);
});

test('reference：合法文档按原 URL 取回并穿过解析器', async () => {
  let seen = '';
  const result = await loadGameReference(manifest, 'http://host/', async (url) => {
    seen = url;
    return { ok: true, status: 200, text: async () => JSON.stringify(validDoc) };
  });
  assert.equal(seen, 'http://host/games/demo/docs/reference.json');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.doc.groups[0].items[0].title, '回合');
});

class FakeNode {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.textContent = '';
    this.className = '';
    this.src = '';
    this.alt = '';
    this.loading = '';
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
}

function fakeDocument() {
  const doc = { createElement: (tag) => new FakeNode(tag, doc) };
  return doc;
}

function collect(node, tags, texts) {
  if (node.tagName) tags.push(node.tagName);
  if (node.textContent) texts.push(node.textContent);
  for (const child of node.children) collect(child, tags, texts);
}

test('reference：文本走 textContent，HTML 标签不会变成 DOM；图片带 alt 与同源路径', () => {
  const doc = fakeDocument();
  const host = new FakeNode('div', doc);
  const title = renderReference(
    host,
    {
      version: 1,
      groups: [
        {
          id: 'x',
          title: '<b>分组</b>',
          items: [
            {
              text: '<script>alert(1)</script> & <b>不是标签</b>',
              images: [{ path: 'images/pic.png', alt: '<img onerror=alert(1)>' }],
            },
          ],
        },
      ],
    },
    'http://host',
    'demo',
  );
  const tags = [];
  const texts = [];
  collect(host, tags, texts);
  assert.equal(title, DEFAULT_REFERENCE_TITLE);
  assert.ok(texts.includes('<script>alert(1)</script> & <b>不是标签</b>'), 'HTML 必须原样作为文本显示');
  assert.ok(texts.includes('<b>分组</b>'));
  assert.equal(tags.includes('SCRIPT'), false);
  assert.equal(tags.includes('B'), false);
  const img = host.children[0].children[1].children[1].children[0];
  assert.equal(img.tagName, 'IMG');
  assert.equal(img.src, 'http://host/games/demo/images/pic.png');
  assert.equal(img.alt, '<img onerror=alert(1)>');
  assert.equal(img.loading, 'lazy');

  img.onerror();
  assert.equal(img.hidden, true);
  const afterError = [];
  collect(host, [], afterError);
  assert.ok(afterError.includes('<img onerror=alert(1)>'), '图片 404 时要直接显示 alt 文案');
});

test('reference：渲染器不碰 innerHTML', () => {
  assert.doesNotMatch(SOURCE, /innerHTML/);
  assert.match(SOURCE, /textContent/);
});
