import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GAME_REFERENCE_LIMITS,
  isValidGameReferenceEntry,
  parseGameReference,
} from '@lizardon386/core-abi';

function doc(overrides = {}) {
  return {
    version: 1,
    title: '变色对决规则',
    groups: [
      {
        id: 'basic',
        title: '基本规则',
        items: [{ title: '出牌', text: '打出一张与桌面颜色或数字相同的牌。' }],
      },
    ],
    ...overrides,
  };
}

test('reference：合法文档通过并保留可选字段', () => {
  const result = parseGameReference(
    doc({
      groups: [
        {
          id: 'basic',
          title: '基本规则',
          items: [
            {
              title: '出牌',
              text: '打出一张与桌面颜色或数字相同的牌。',
              images: [{ path: 'images/play.png', alt: '出牌示意', caption: '同色或同数字' }],
            },
          ],
        },
        { id: 'score', title: '计分', items: [{ text: '先出完手牌的人赢。' }] },
      ],
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.doc.title, '变色对决规则');
  assert.equal(result.doc.groups.length, 2);
  assert.equal(result.doc.groups[0].items[0].images[0].caption, '同色或同数字');
  assert.equal(result.doc.groups[1].items[0].title, undefined);
});

test('reference：接受原始 JSON 文本', () => {
  const result = parseGameReference(JSON.stringify(doc()));
  assert.equal(result.ok, true);
  assert.equal(parseGameReference('{').ok, false);
  assert.match(parseGameReference('{').error, /不是合法的 JSON/);
});

test('reference：version 与分组上限', () => {
  assert.equal(parseGameReference({ version: 2, groups: [] }).ok, false);
  assert.match(parseGameReference({ version: 2, groups: [] }).error, /version 当前只支持 1/);
  assert.equal(parseGameReference({ version: 1, groups: [] }).ok, false);

  const tooMany = { version: 1, groups: Array.from({ length: 21 }, (_, i) => ({ id: `g${i}`, title: '组', items: [] })) };
  assert.match(parseGameReference(tooMany).error, /最多 20 组/);
});

test('reference：条目总数与单条文字上限', () => {
  const items = Array.from({ length: GAME_REFERENCE_LIMITS.items + 1 }, () => ({ text: '一' }));
  const result = parseGameReference({ version: 1, groups: [{ id: 'g', title: '组', items }] });
  assert.equal(result.ok, false);
  assert.match(result.error, /条数合计最多 120 条/);

  const longText = parseGameReference({
    version: 1,
    groups: [{ id: 'g', title: '组', items: [{ text: '字'.repeat(2001) }] }],
  });
  assert.match(longText.error, /text 超过 2000 字/);
});

test('reference：标题与分组 id 校验', () => {
  assert.match(
    parseGameReference({ version: 1, groups: [{ id: 'g', title: '组'.repeat(41), items: [] }] }).error,
    /title 超过 40 字/,
  );
  assert.match(
    parseGameReference({ version: 1, title: '标'.repeat(41), groups: [{ id: 'g', title: '组', items: [] }] }).error,
    /^title 超过 40 字/,
  );
  assert.match(
    parseGameReference({
      version: 1,
      groups: [
        { id: 'g', title: '一', items: [] },
        { id: 'g', title: '二', items: [] },
      ],
    }).error,
    /id 与前面的分组重复/,
  );
  assert.match(
    parseGameReference({ version: 1, groups: [{ id: '', title: '组', items: [] }] }).error,
    /id 必须是非空字符串/,
  );
});

test('reference：图片路径、扩展名与 alt/caption', () => {
  const item = (images) => ({ version: 1, groups: [{ id: 'g', title: '组', items: [{ text: '文字', images }] }] });
  const ok = parseGameReference(item([{ path: 'images/a.webp', alt: '图' }]));
  assert.equal(ok.ok, true);

  assert.match(parseGameReference(item([{ path: '../a.png', alt: '图' }])).error, /合法的包内相对路径/);
  assert.match(parseGameReference(item([{ path: '/a.png', alt: '图' }])).error, /合法的包内相对路径/);
  assert.match(parseGameReference(item([{ path: 'a.txt', alt: '图' }])).error, /扩展名只允许/);
  assert.match(parseGameReference(item([{ path: 'a.png', alt: '' }])).error, /alt 不能为空/);
  assert.match(parseGameReference(item([{ path: 'a.png', alt: '图', caption: '注'.repeat(121) }])).error, /caption 超过 120 字/);

  const seven = Array.from({ length: 7 }, (_, i) => ({ path: `a${i}.png`, alt: '图' }));
  assert.match(parseGameReference(item(seven)).error, /每项最多 6 张图/);
});

test('reference：文档体积上限', () => {
  const big = { version: 1, title: 'x'.repeat(70 * 1024), groups: [{ id: 'g', title: '组', items: [] }] };
  const result = parseGameReference(big);
  assert.equal(result.ok, false);
  assert.match(result.error, /超过 65536 字节/);
  assert.match(parseGameReference('x'.repeat(70 * 1024)).error, /超过 65536 字节/);
});

test('reference：entry 必须是包内 .json 路径', () => {
  assert.equal(isValidGameReferenceEntry('reference.json'), true);
  assert.equal(isValidGameReferenceEntry('docs/reference.json'), true);
  assert.equal(isValidGameReferenceEntry('docs\\reference.json'), false);
  assert.equal(isValidGameReferenceEntry('/reference.json'), false);
  assert.equal(isValidGameReferenceEntry('../reference.json'), false);
  assert.equal(isValidGameReferenceEntry('docs//reference.json'), false);
  assert.equal(isValidGameReferenceEntry('reference.txt'), false);
});
