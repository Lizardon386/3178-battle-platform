import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEAT_ROLES } from '@lizardon386/core-abi';

/**
 * 表现层防呆：app.ts 里 className 发出去的每个类，style.css 里就得真的有一条规则。
 * 上界版本就是栽在这儿的——CSS 写 .seat-ready，JS 发 is-ready，
 * "已准备/我的座位/离线"三种状态静默地没有任何样式，肉眼看不出来。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const appSource = readFileSync(join(HERE, '..', 'src', 'app.ts'), 'utf8');
const css = readFileSync(join(HERE, '..', 'public', 'style.css'), 'utf8');
const pageHtml = readFileSync(join(HERE, '..', 'public', 'index.html'), 'utf8');
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

test('listbox.ts 发出的类名同样要有规则（新组件最容易漏样式）', () => {
  const src = readFileSync(join(HERE, '..', 'src', 'listbox.ts'), 'utf8');
  const missing = emittedClasses(src).filter((name) => !hasRule(name) && !vendorCss.includes(`.${name}`));
  assert.deepEqual(missing, [], `自绘下拉发了这些类名但没有任何样式：${missing.join('、')}`);
});

test('自绘下拉：可见箭头在 caret 元素上，原生 select 只当数据源', () => {
  assert.match(cssCode, /\.bp-native-select\s*\{[^}]*display:\s*none/, '原生 select 必须彻底不占位（它只当数据源）');
  const caret = cssCode.match(/(?:^|\n)\.bp-listbox-caret\s*\{([^}]*)\}/);
  assert.ok(caret && /background-image:\s*url\(/.test(caret[1]), '可见箭头得挂在 .bp-listbox-caret 上');
  assert.match(cssCode, /\.bp-listbox-trigger\s*\{[^}]*background-image:\s*none/, '按钮抄了 form-select 的类，必须把那份箭头关掉，否则两个箭头');
  const popup = cssCode.match(/(?:^|\n)\.bp-listbox-list\s*\{([^}]*)\}/);
  assert.ok(popup, '缺少弹层规则');
  assert.match(popup[1], /background-color:\s*var\(--bp-panel\)/, '弹层底色要走主题变量，这是换自绘下拉的全部理由');
  assert.equal(/box-shadow/.test(popup[1]), false, '弹层不许加阴影（扁平约定仍然有效）');
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

test('对局区全宽：游戏拉通整行，席位横排，聊天/房主进可收起侧栏', () => {
  for (const id of ['room-layout', 'game-host', 'side-panels', 'btn-toggle-drawer', 'btn-close-drawer', 'drawer-backdrop', 'room-playing-head', 'room-left', 'room-meta', 'drawer-host']) {
    assert.match(pageHtml, new RegExp(`id="${id}"`), `index.html 缺少 #${id}`);
  }
  assert.match(pageHtml, /aria-controls="side-panels"/, '侧栏按钮要声明控制目标');
  assert.match(pageHtml, /aria-keyshortcuts="D"/, '侧栏要声明快捷键');
  assert.match(cssCode, /\.room-layout\.is-playing\s*\{[^}]*display:\s*grid/s, 'playing 布局要切成整行网格');
  assert.match(cssCode, /\.game-host\s*\{[^}]*min-height:\s*560px/s, '对局区高度不能低于 560px');
  assert.match(cssCode, /#side-panels\.is-open/, '侧栏要有打开态');
  assert.match(cssCode, /#side-panels[^}]*visibility:\s*hidden/s, '侧栏默认要收起');
  assert.match(appSource, /btn-toggle-drawer/, 'app.ts 要绑定侧栏按钮');
  assert.match(appSource, /Escape/, '侧栏要支持 Esc 关闭');
  assert.match(appSource, /aria-hidden/, '侧栏要同步 aria-hidden');
});

test('规则与资料：房间规则卡、大厅资料入口、抽屉都在', () => {
  for (const id of ['btn-reference-lobby', 'btn-reference', 'reference-panel', 'reference-body', 'btn-reference-close', 'reference-backdrop', 'rule-config', 'rule-config-body', 'rule-config-hint', 'btn-save-rule-config', 'host-console', 'countdown-block']) {
    assert.match(pageHtml, new RegExp(`id="${id}"`), `index.html 缺少 #${id}`);
  }
  const lobbyStart = pageHtml.indexOf('id="screen-lobby"');
  const roomStart = pageHtml.indexOf('id="screen-room"');
  const ruleStart = pageHtml.indexOf('id="rule-config"');
  assert.ok(ruleStart > roomStart && ruleStart > lobbyStart, '规则卡应在房间页，不该留在大厅建房表单里');
  assert.match(pageHtml, /aria-controls="reference-panel"/, '规则按钮要声明控制目标');
  assert.match(cssCode, /\.reference-panel\s*\{[^}]*visibility:\s*hidden/s, '资料抽屉默认收起');
  assert.match(cssCode, /\.reference-panel\.is-open/, '资料抽屉要有打开态');
  assert.match(cssCode, /\.host-console-head\s*\{/, '规则与房主操作要有合并后的卡片头');
  assert.match(cssCode, /\.room-layout:not\(\.is-playing\)\s*\{[^}]*grid-template-columns:\s*minmax\(340px,\s*380px\)\s+minmax\(0,\s*3fr\)\s+minmax\(0,\s*2fr\)/s, 'lobby 要三栏：左栏房信息/房主台，席位与聊天并排');
  assert.match(cssCode, /#room-left\s*\{[^}]*gap:\s*0/s, '房信息与规则要连成一张左栏卡');
  assert.match(cssCode, /#room-left\s*\{[^}]*border:\s*1px solid var\(--bp-line\)/s, '左栏要有自己的整卡边框');
  assert.match(cssCode, /--bp-room-col-h:\s*clamp\(520px,\s*calc\(100vh - 208px\),\s*760px\)/, '三栏要共用同一个桌面高度');
  assert.match(cssCode, /#room-left\s*\{[^}]*height:\s*var\(--bp-room-col-h\)/s, '左栏要和右侧两栏等高');
  assert.match(cssCode, /#seat-column\s*\{[^}]*height:\s*var\(--bp-room-col-h\)/s, '席位栏要共用桌面高度');
  assert.match(cssCode, /#chat-panel\s*\{[^}]*height:\s*var\(--bp-room-col-h\)/s, '聊天栏要共用桌面高度');
  assert.match(cssCode, /#room-left-host \.host-console-body\s*\{[^}]*overflow-y:\s*auto/s, '左栏房主台要在栏内滚动，不能把整栏撑破');
  assert.match(cssCode, /\.seat-transfer-button\s*\{/, '真人席位行要有转交房主按钮样式');
  assert.match(appSource, /attachSeatTransfer/, '真人席位行要直接渲染转交房主按钮');
  assert.match(appSource, /hostTransfer/, '行内转交要走 hostTransfer');
  assert.match(appSource, /解散房间/, '房主的离开按钮要改成解散房间');
  assert.match(appSource, /placeRoomChrome/, '房间头与房主台要按 lobby/playing 搬家而不是复制');
  assert.match(cssCode, /\.reference-panel\s*\{[^}]*width:\s*min\(1400px/s, '规则资料面板要接近全屏');
  assert.match(cssCode, /\.reference-body\s*\{[^}]*grid-template-columns:\s*repeat\(2/s, '宽屏资料要双栏');
  assert.match(cssCode, /\.seat-slot-button\s*\{/, '座位号码牌要能作为颜色入口');
  assert.match(cssCode, /\.seat-color-menu\s*\{/, '颜色菜单要有样式');
  assert.match(cssCode, /\.seat-ai-difficulty\s*\{/, '电脑难度要在席位行内');
  assert.match(cssCode, /\.seat\.has-seat-color[^}]*border-left-color/, '座位颜色要驱动左侧色条');
  assert.match(cssCode, /\.rule-chip\s*\{/, '房间规则摘要要有样式');
  assert.match(cssCode, /\.bp-game-row\s*\{/, '大厅游戏选择与查看规则要同一行');
  assert.match(appSource, /loadGameReference/, 'app.ts 要懒加载资料');
  assert.match(appSource, /renderReference/, 'app.ts 要用纯文本渲染资料');
  assert.match(appSource, /renderRuleConfig/, '房间页要渲染规则区');
  assert.match(appSource, /saveRuleConfig/, '房主要能提交规则');
  assert.match(appSource, /仅房主可操作/, '房主端要有固定提示');
  assert.match(appSource, /ruleConfig/, '改规则要走房主专用命令');
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

/**
 * 昵称记忆（静态源码守卫，形状同上面的 className 检查）。
 * 原 bug：只在 connectTo 里写一次 `输入 || '无名玩家'`，于是（1）改完名没点按钮就刷新＝没改，
 * （2）某次空字段点下去就把"无名玩家"永久钉进存储——用户报的"每次进来都变回无名玩家"。
 * 真浏览器里的行为我另外手工验过；这里钉的是"不许再把兜底值写进存储"这个回归形状。
 */
test('昵称：改了立刻记，空字段与占位称呼都不许写进存储', () => {
  // 先剥注释再判：本文件上面那句"@layer / url() 的检查要先剥注释，否则注释里提一句就把检查判红"
  // 立刻在我身上复现了一次——我在新监听的注释里引了一遍旧代码 `输入 || '无名玩家'`，守卫就红了。
  const code = appSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const sets = [...code.matchAll(/this\.nick\.set\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.deepEqual(sets, ['name'], '只有 rememberNick 那一处允许写昵称存储');
  assert.match(code, /if \(name && name !== DEFAULT_NICK\)/, '占位称呼不许进存储');
  assert.match(
    code,
    /on\('nick', 'input', \(\) => this\.rememberNick\(this\.typedNick\(\)\)\)/,
    '改名要立刻持久化，不能等到点建房/加入才存',
  );
  assert.match(code, /\.value = this\.nick\.get\(\)/, '开机要回填上次记住的昵称');
  assert.doesNotMatch(code, /\|\|\s*'无名玩家'/, '兜底称呼不许再和存储写入写在同一行');
  assert.match(code, /nick: this\.currentNick\(\)/, 'hello 与界面显示要走同一个解析口，避免"显示空、发出去无名玩家"');
});
