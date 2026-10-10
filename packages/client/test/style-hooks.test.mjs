import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEAT_ROLES } from '@bp/protocol';

/**
 * 表现层防呆：app.ts 里 className 发出去的每个类，style.css 里就得真的有一条规则。
 * 上界版本就是栽在这儿的——CSS 写 .seat-ready，JS 发 is-ready，
 * "已准备/我的座位/离线"三种状态静默地没有任何样式，肉眼看不出来。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(HERE, '..', 'src', 'app.ts'), 'utf8');
const css = readFileSync(join(HERE, '..', 'public', 'style.css'), 'utf8');
// 断言"不许出现 @layer / url()"时要先剥掉注释，否则注释里提一句就把检查判红（上界就这么误报过）
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');

function emittedClasses(source) {
  const found = new Set();
  const patterns = [/className\s*=\s*'([^']+)'/g, /className\s*=\s*`([^`]+)`/g, /classList\.(?:add|remove|toggle)\(\s*'([^']+)'/g];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      for (const token of match[1].split(/[\s${}?:+']+/)) {
        const clean = token.trim().replace(/^`+|`+$/, '');
        if (clean && /^[a-z][a-z0-9-]*$/i.test(clean)) found.add(clean);
      }
    }
  }
  return [...found];
}

function hasRule(selector) {
  return css.includes(`.${selector}`);
}

test('app.ts 发出的每个类名在 style.css 里都有对应规则', () => {
  const missing = emittedClasses(appSource).filter((name) => !hasRule(name));
  assert.deepEqual(missing, [], `这些类名 DOM 会发出去但样式里没有：${missing.join('、')}`);
});

test('状态类必须命中实际发名字：is-ready / is-me / is-offline', () => {
  for (const name of ['is-ready', 'is-me', 'is-offline']) {
    assert.ok(appSource.includes(name), `app.ts 应该还在发 ${name}`);
    assert.ok(hasRule(name), `style.css 必须有 .${name} 规则`);
  }
});

test('四种席位角色都要有各自的样式（房主/玩家/观战/电脑）', () => {
  for (const role of SEAT_ROLES) {
    assert.ok(hasRule(`seat-${role}`), `style.css 缺少 .seat-${role}`);
  }
});

test('样式表不许依赖外网字体、外链图片或 @layer', () => {
  assert.equal(/@import\s+url\(/i.test(cssCode), false, '内网双击运行时取不到外网资源');
  assert.equal(/@layer\b/.test(cssCode), false, '老 Chromium/Edge 会把未知 at-rule 整块跳过，等于整站裸奔');
  assert.equal(/url\((?!["']?data:)/i.test(cssCode), false, '表现层不许引外部图片');
  assert.ok(/--font-cn:/.test(css) && /--font-mono:/.test(css), '字阶要成对：中文正文 + 等宽数字');
});

test('减动效偏好必须能关掉全部动画', () => {
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(block.slice(0, 200), /animation:\s*none\s*!important/);
});
