import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEAT_ROLES } from '@bp/protocol';

/**
 * 表现层防呆：app.ts 里 className 发出去的每个类，style.css 里就得真的有一条规则。
 * 上界版本就是栽在这儿的——CSS 写 .seat-ready，JS 发 is-ready，
 * "已准备/我的座位/离线"三种状态静默地没有任何样式，肉眼看不出来。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const appSource = readFileSync(join(HERE, '..', 'src', 'app.ts'), 'utf8');
const css = readFileSync(join(HERE, '..', 'public', 'style.css'), 'utf8');
// 断言"不许出现 @layer / url()"时要先剥掉注释，否则注释里提一句就把检查判红（上界就这么误报过）
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** 底座框架的样式（同源挂在 /vendor/ 下），类名允许来自这里而不必在我们自己的 css 里重复。 */
const VENDOR = [
  join(ROOT, 'node_modules', '@tabler', 'core', 'dist', 'css', 'tabler.min.css'),
  join(ROOT, 'node_modules', '@tabler', 'icons-webfont', 'dist', 'tabler-icons.min.css'),
];
const vendorCss = VENDOR.filter((p) => existsSync(p)).map((p) => readFileSync(p, 'utf8')).join('\n');

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

test('Tabler 底座在 node_modules 里可得（同源路由要有东西可挂）', () => {
  for (const path of VENDOR) {
    assert.ok(existsSync(path), `缺底座样式文件：${path}`);
  }
});

test('app.ts 发出的每个类名都要有规则（我们的 css 或 Tabler 底座）', () => {
  const missing = emittedClasses(appSource).filter((name) => !hasRule(name) && !vendorCss.includes(`.${name}`));
  assert.deepEqual(missing, [], `这些类名 DOM 会发出去但没有任何样式：${missing.join('、')}`);
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

test('字体必须同源分发，且 CSS 引用的文件真的在盘上', () => {
  // 便携包要在没网的内网双击可用：外链字体/图片当场退化，所以只准同源 /fonts/。
  const urls = [...cssCode.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);
  assert.ok(urls.length > 0, '展示了本地字体就该有 @font-face 的 url()');
  for (const url of urls) {
    assert.match(url, /^\/fonts\//, `字体必须同源：${url}`);
    assert.ok(existsSync(join(HERE, '..', 'public', url.replace(/^\//, ''))), `CSS 引用了不存在的字体文件：${url}`);
  }
  assert.equal(/@import\s+url\(/i.test(cssCode), false, '不许用 @import 拉外部资源');
  assert.equal(/url\(\s*["']?https?:/i.test(cssCode), false, '不许引外网字体或图片');
  assert.equal(/@layer\b/.test(cssCode), false, '老 Chromium/Edge 会把未知 at-rule 整块跳过，等于整站裸奔');
  const faces = [...cssCode.matchAll(/font-family:\s*"([^"]+)";/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(faces)].sort(),
    ['BP Display', 'BP Mono', 'BP UI'],
    '字体令牌要成套：展示体 + 拉丁正文 + HUD 等宽',
  );
  assert.ok(/--bp-font-display:/.test(css) && /--bp-font-mono:/.test(css), '字体令牌要成对：展示体 + HUD 等宽');
  assert.ok(/\.hidden\s*\{[^}]*display:\s*none\s*!important/.test(cssCode), 'app.ts 靠 .hidden 切屏，Bootstrap 5 不再提供这个类');
});

test('紫底版仍然不许有渐变、关键帧动画和发光阴影', () => {
  // 上一轮用户否掉渐变与动画；这一轮他给了参考站并只批"放开 0.2s 过渡"。
  // 所以契约变成：允许短过渡，仍然无关键帧、无渐变、无发光。三条都是可判定的，不是口味之争。
  assert.equal(/gradient\(/i.test(cssCode), false, '出现渐变就超出批准范围（参考站有渐变，但用户没批）');
  assert.equal(/@keyframes/.test(cssCode), false, '参考站本身 0 个关键帧，我们也不写');
  assert.equal(/text-shadow:\s*[^n]/i.test(cssCode.replace(/text-shadow:\s*none/g, '')), false, '不要发光');
  assert.equal(/box-shadow:\s*0 0 \d+/i.test(cssCode), false, '参考站的 hover 发光是 rgba(99,102,241,.15)，用户没批这一档');
  assert.match(cssCode, /\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation:\s*none\s*!important/, '要把 Tabler 自带的循环动画一起压掉');
});

test('过渡必须有界：最长 0.3 秒，且不许用 all', () => {
  // 参考站实测只有 0.2s / 0.3s 两档。放成 all 或拉长到 1s 就不是"同款"而是另一套东西了。
  const decls = [...cssCode.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1]);
  assert.ok(decls.length >= 2, '至少要有控件与卡片两档过渡');
  for (const d of decls) {
    assert.equal(/\ball\b/.test(d), false, `不许 transition: all（会把框架的位移/缩放一起带进来）：${d}`);
    for (const raw of [...d.matchAll(/(\d*\.?\d+)(ms|s)\b/g)]) {
      const sec = raw[2] === 'ms' ? Number(raw[1]) / 1000 : Number(raw[1]);
      assert.ok(sec <= 0.3, `过渡超过 0.3 秒：${d}`);
    }
  }
});

test('减动效偏好必须能关掉全部动画', () => {
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(block.slice(0, 200), /animation:\s*none\s*!important/);
});

test('下拉控件必须有箭头，且展开列表跟着主题色', () => {
  // 用户截图指出的两件事：① 看不出这是下拉（没标志）；② 点开是系统浅灰，跟紫底不搭。
  // ①的根因是我们用 background 简写把 Tabler 的 background-image 清成了 none，所以这里既查"有箭头"也查"没人再用简写"。
  const selectRule = cssCode.match(/(?:^|\n)\.form-select\s*\{([^}]*)\}/);
  assert.ok(selectRule, '找不到 .form-select 规则');
  assert.match(selectRule[1], /background-image:\s*url\(/, '下拉标志没了：appearance:none 之后必须自己画箭头');
  assert.match(selectRule[1], /background-position:\s*right/, '箭头要钉在右侧，否则和文字叠在一起');
  assert.match(selectRule[1], /padding-right:\s*\d+px/, '要给箭头让出内边距');

  for (const m of cssCode.matchAll(/\.[a-z-]*(form-control|form-select)[^{]*\{([^}]*)\}/gi)) {
    assert.equal(/(^|[;\s])background:\s*[^-]/.test(m[2]), false, `${m[0].slice(0, 28)} 用了 background 简写，会把箭头清成 none`);
  }

  const optionRule = cssCode.match(/(?:^|[^-\w])option\s*\{([^}]*)\}/);
  assert.ok(optionRule, '没给 option 上色，展开列表就会用系统浅灰');
  assert.match(optionRule[1], /background-color:/, 'option 要有自己的底色');
  assert.match(cssCode, /option:checked[^{]*\{[^}]*background-color:/, '选中条要跟着主题色，不然还是系统灰');
});
