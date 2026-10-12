/*
 * UI 层并发猴测：在真实页面里开 N 个同源 iframe，每个 iframe 是一个独立的
 * PlatformApp 实例 + 独立 WS 连接 + 独立 DOM，随机点击/输入，每步跑界面不变式。
 *
 * 为什么用 iframe 而不是开 N 个标签页：browser-use 这边只控得到一个页面，
 * 而同源 iframe 共享 localStorage——这正好复现"同一个人在一台机器上开好几个标签"，
 * 票据互相覆盖是真会发生的。
 *
 * 用法：把本文件整份内容作为 evaluate_script 的函数体注入顶层页面，参数写在 window.__bpUi 上。
 * 顶层页面本身要先由本地壳（http://127.0.0.1:3178/）提供。
 */
async function bpUiMonkey(opts) {
  const USERS = (opts && opts.users) || 4;
  const STEPS = (opts && opts.steps) || 200;
  const SEED = (opts && opts.seed) || 12345;

  let s = SEED >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

  const bad = [];
  const note = (kind, frame, detail, extra) => {
    bad.push({ kind, frame, detail, extra: extra || '' });
  };

  // 步进不能用链式 setTimeout：in-app Browser 的页面是 hidden 的，
  // Chrome 对隐藏页的链式计时器做强制节流（约 1 次/分钟），跑一百步就开始爬。
  // 这里用 MessageChannel（不是计时器，不节流）让出事件循环，再用一次真实 /health 往返做节拍。
  const chan = new MessageChannel();
  const yieldToLoop = () =>
    new Promise((r) => {
      chan.port1.onmessage = () => r();
      chan.port2.postMessage(0);
    });
  const pace = async () => {
    for (let i = 0; i < 3; i++) {
      await yieldToLoop();
      try {
        await fetch('/health', { cache: 'no-store', signal: AbortSignal.timeout(2000) });
      } catch {
        /* 房主端正在重启，正常 */
      }
    }
  };

  // ---- 起 N 个用户 ----
  document.getElementById('bp-monkey-host')?.remove();
  const host = document.createElement('div');
  host.id = 'bp-monkey-host';
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1280px;height:900px';
  document.body.append(host);

  const frames = [];
  for (let i = 0; i < USERS; i++) {
    const f = document.createElement('iframe');
    f.style.cssText = 'width:1280px;height:900px;border:0';
    f.src = '/';
    host.append(f);
    frames.push({ id: i, f, win: null, doc: null, errors: [] });
  }
  await new Promise((r) => setTimeout(r, 2500));
  for (const u of frames) {
    u.win = u.f.contentWindow;
    u.doc = u.f.contentDocument;
    if (!u.win || !u.doc) {
      note('iframe 没起来', u.id, '拿不到 contentWindow');
      continue;
    }
    u.win.addEventListener('error', (e) => u.errors.push(`error: ${e.message}`));
    u.win.addEventListener('unhandledrejection', (e) => u.errors.push(`rejection: ${String(e.reason).slice(0, 160)}`));
    // 昵称与地址先填好，省得每次都在大厅空转
    const nick = u.doc.getElementById('nick');
    if (nick) {
      nick.value = `猴UI${u.id}`;
      nick.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const addr = u.doc.getElementById('host-address');
    if (addr) addr.value = location.host;
  }

  const BUTTONS = [
    'btn-create', 'btn-join', 'btn-ready', 'btn-reconnect', 'btn-leave',
    'btn-start', 'btn-add-ai', 'btn-transfer', 'btn-kick', 'btn-copy-invite',
    'btn-close', 'btn-use-book', 'btn-forget', 'btn-send',
  ];
  const INPUTS = ['room-name', 'room-code', 'host-address', 'join-password', 'chat-input', 'seat-slots', 'room-password'];

  function click(u, id) {
    const b = u.doc.getElementById(id);
    if (!b) return false;
    b.click();
    return true;
  }

  /**
   * 真实鼠标序列：pointerdown → mousedown →（焦点从原焦点元素移走）→ pointerup → mouseup → click。
   * 只发 click 会漏掉一整类 bug：自绘下拉曾经挂 blur→close，真鼠标按在选项上时焦点先跑掉、
   * 列表被 display:none，于是 click 根本不触发——合成 click 却"测试通过"。
   */
  function realClick(u, el) {
    const w = u.win;
    const prev = u.doc.activeElement;
    const mouse = (type) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, view: w }));
    const pointer = (type) => el.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }));
    pointer(el, 'pointerover');
    el.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, view: w }));
    pointer(el, 'pointerdown');
    mouse('mousedown');
    if (prev && prev !== el && typeof prev.blur === 'function') prev.blur();
    pointer(el, 'pointerup');
    mouse('mouseup');
    mouse('click');
  }

  /**
   * 自包含探针：自己开一个下拉，再用真实鼠标序列点一个"和当前值不同"的选项。
   * 不能写成"正好有列表开着时才探"——列表绝大多数时间是关着的，那样探针等于没跑。
   */
  async function probeOptionClick(u) {
    const selects = [...u.doc.querySelectorAll('select.form-select')].filter((s) => s.options.length >= 2);
    if (selects.length === 0) return false;
    const sel = pick(selects);
    const box = sel.closest('.bp-listbox');
    const listEl = box.querySelector('.bp-listbox-list');
    const trigger = box.querySelector('.bp-listbox-trigger');
    if (!listEl.classList.contains('hidden')) realClick(u, trigger); // 先关掉，保证状态已知
    await new Promise((r) => setTimeout(r, 30));
    realClick(u, trigger);
    await new Promise((r) => setTimeout(r, 60));
    if (listEl.classList.contains('hidden')) {
      note('点开下拉失败', u.id, `#${sel.id} 真点触发器后列表仍是 hidden`);
      return true;
    }
    const rows = [...listEl.querySelectorAll('.bp-listbox-option')];
    const idx = rows.findIndex((r) => r.getAttribute('aria-selected') !== 'true' && !r.classList.contains('is-disabled'));
    if (idx < 0) return true;
    const target = rows[idx];
    const want = sel.options[idx]?.value;
    const before = sel.value;
    const w = u.win;
    const prev = u.doc.activeElement;
    const mouse = (type) => target.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, view: w }));
    const pointer = (type) => target.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }));
    pointer('pointerover');
    target.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, view: w }));
    pointer('pointerdown');
    mouse('mousedown');
    // 必须**派发 blur 事件**而不是调 prev.blur()：未聚焦的文档里 .blur() 不会真的派发事件，
    // 于是"按下瞬间焦点跑掉"这个真实条件在隐藏页里根本复现不出来（本轮在这里白测了三次）。
    if (prev && prev !== target && prev !== u.doc.body) prev.dispatchEvent(new w.Event('blur'));
    // 关键断言：真浏览器在元素被 display:none 之后就不会把 click 送给它，
    // 而 dispatchEvent 是无条件送达的——所以只能在这里查"中途有没有被藏起来"。
    if (listEl.classList.contains('hidden')) {
      note('点选项时列表在 mousedown 与 mouseup 之间被藏起来', u.id, `#${sel.id} 真鼠标下 click 不会触发，选项点不动`);
      return true;
    }
    pointer('pointerup');
    mouse('mouseup');
    mouse('click');
    if (want && sel.value === before) {
      note('自绘下拉点不动', u.id, `#${sel.id} 真点选项后 value 仍是 ${before}（期望 ${want}）`);
    }
    return true;
  }

  async function act(u) {
    const roll = rnd();
    if (roll < 0.42) {
      click(u, pick(BUTTONS));
    } else if (roll < 0.5) {
      const t = u.doc.querySelector('.bp-listbox-trigger');
      if (t) realClick(u, t);
    } else if (roll < 0.58) {
      // 真点一个选项并断言值被改掉；没有展开着的列表时改为开一个
      if (!(await probeOptionClick(u))) {
        const t = u.doc.querySelector('.bp-listbox-trigger');
        if (t) realClick(u, t);
      }
    } else if (roll < 0.64) {
      const t = u.doc.querySelector('.bp-listbox-trigger');
      if (t) {
        t.focus();
        ['ArrowDown', 'ArrowUp', 'End', 'Home', 'Enter', 'Escape'].forEach((k) => {
          t.dispatchEvent(new u.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
        });
      }
    } else if (roll < 0.78) {
      const id = pick(INPUTS);
      const n = u.doc.getElementById(id);
      if (n) {
        n.value = pick([
          `猴${int(1, 99)}`, '', 'A'.repeat(60), '<script>x</script>', 'emoji 🎲 与中文',
          String(int(1, 9)), 'zzzz', location.host,
        ]);
        n.dispatchEvent(new Event('input', { bubbles: true }));
        n.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else if (roll < 0.82) {
      const sel = u.doc.getElementById(pick(['game-select', 'transfer-target', 'kick-target']));
      if (sel && sel.options.length) {
        sel.value = sel.options[int(0, sel.options.length - 1)].value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else if (roll < 0.9) {
      const chk = u.doc.getElementById(pick(['chk-spectate', 'chk-hidden']));
      if (chk) {
        chk.checked = !chk.checked;
        chk.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else if (roll < 0.96) {
      const box = u.doc.getElementById('chat-input');
      if (box) {
        box.value = `猴话 ${int(1, 999)}`;
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
    } else {
      // 连点：模拟"手快按了两下"
      click(u, pick(['btn-create', 'btn-ready', 'btn-start', 'btn-join']));
      click(u, pick(['btn-create', 'btn-ready', 'btn-start', 'btn-join']));
    }
  }

  function check(u) {
    const d = u.doc;
    if (!d || !d.getElementById) return;
    const lobby = d.getElementById('screen-lobby');
    const room = d.getElementById('screen-room');
    if (!lobby || !room) {
      note('界面骨架丢了', u.id, '找不到两个屏幕节点');
      return;
    }
    const lobbyOn = !lobby.classList.contains('hidden');
    const roomOn = !room.classList.contains('hidden');
    // A 两屏互斥
    if (lobbyOn === roomOn) note('两屏同时显示或同时隐藏', u.id, `lobby=${lobbyOn} room=${roomOn}`);
    // B "你"最多一个
    const me = [...d.querySelectorAll('.seat.is-me')];
    if (me.length > 1) note('席位行出现多个"你"', u.id, `${me.length} 个`);
    // C 状态行不得漏出英文错误码
    const status = d.getElementById('lobby-status');
    if (status) {
      const m = status.textContent.match(/\b(NOSEAT|NOTHOST|HOSTONLY|NOROOM|FULL|RULES|VERSION|PROTOCOL|RATE|BADMSG|PHASE|NOTFOUND|UNAUTH)\b/);
      if (m) note('状态行漏出原始错误码', u.id, `${m[0]} ← ${status.textContent.trim().slice(0, 90)}`);
    }
    // D 席位行数量与槽位一致
    const rows = [...d.querySelectorAll('.seat')];
    if (roomOn) {
      const hud = d.getElementById('room-code-hud');
      if (hud && !/^[A-Z0-9]{4,12}$/.test(hud.textContent.trim())) {
        note('房号铭牌不是合法字符集', u.id, JSON.stringify(hud.textContent.trim().slice(0, 30)));
      }
      if (rows.length === 0) note('在房间内却没有任何席位行', u.id, '');
      if (rows.length > 12) note('席位行多到不合理', u.id, `${rows.length} 行`);
    }
    // E 没有座位时不该还能点"准备"（app.ts 的 renderHostPanel 只在"有座位且非房主"时更新这个按钮，
    //   座位一消失它就保持上一次的可点状态——正是"点了得到一句看不懂的话"的来源）
    const ready = d.getElementById('btn-ready');
    const meRow = me[0];
    if (roomOn && ready) {
      if (me.length === 0 && !ready.disabled) {
        note('无座位但"准备"按钮仍可点', u.id, `状态：${status ? status.textContent.trim().slice(0, 60) : ''}`);
      }
      if (meRow && meRow.classList.contains('seat-host') && !ready.disabled) {
        note('房主的"准备"按钮可点但不参与开局闸', u.id, `文案：${ready.textContent.trim()}`);
      }
    }
    // F 倒计时格式
    const cd = d.getElementById('turn-countdown');
    if (cd && cd.textContent.trim() && !/^剩 \d+ 秒$/.test(cd.textContent.trim())) {
      note('倒计时文案不合格式', u.id, JSON.stringify(cd.textContent.trim().slice(0, 40)));
    }

    // G "静默丢失"类：这些属性没了不会报错、也不会留痕，只有算一遍才发现（下拉箭头就是这么消失的）
    const gcs = (n) => u.win.getComputedStyle(n);
    for (const s of d.querySelectorAll('select.form-select')) {
      // 换成自绘下拉后，原生 select 是 display:none 的数据源，可见箭头在 .bp-listbox-caret 上
      const box = s.closest('.bp-listbox');
      if (!box) {
        note('下拉没被自绘组件接管', u.id, `#${s.id} 外面没有 .bp-listbox`);
        continue;
      }
      const trigger = box.querySelector('.bp-listbox-trigger');
      const caret = box.querySelector('.bp-listbox-caret');
      const listEl = box.querySelector('.bp-listbox-list');
      if (!trigger || !caret || gcs(caret).backgroundImage === 'none') {
        note('下拉箭头不见了', u.id, `#${s.id} 的 .bp-listbox-caret 没有背景图`);
      }
      if (s.options.length && !trigger.textContent.trim()) {
        note('下拉按钮是空的', u.id, `#${s.id} 有 ${s.options.length} 个选项但触发器没文案`);
      }
      const expanded = trigger.getAttribute('aria-expanded') === 'true';
      const visible = !listEl.classList.contains('hidden');
      if (expanded !== visible) {
        note('aria-expanded 与列表可见性不一致', u.id, `#${s.id} expanded=${expanded} visible=${visible}`);
      }
      if (visible && gcs(listEl).boxShadow !== 'none') {
        note('弹层加了阴影，违反扁平约定', u.id, `#${s.id} box-shadow=${gcs(listEl).boxShadow}`);
      }
    }
    for (const s of d.querySelectorAll('.form-switch .form-check-input')) {
      // Tabler 1.6 的旋钮是 ::before 伪元素画的，不是 input 的 background-image。
      // 拿 background-image 判会得到 4050 条全响的假阳性——本轮就这么误报过一次。
      const knob = u.win.getComputedStyle(s, '::before');
      const kw = parseFloat(knob.width) || 0;
      const kh = parseFloat(knob.height) || 0;
      if (kw <= 0 || kh <= 0) {
        note('开关旋钮不见了', u.id, `#${s.id} 的 ::before 尺寸 ${knob.width}×${knob.height}`);
      } else if (knob.backgroundColor === 'rgba(0, 0, 0, 0)') {
        note('开关旋钮是透明的', u.id, `#${s.id} 的 ::before background-color 透明`);
      }
    }
    const gs = d.getElementById('game-select');
    if (gs && gs.options.length) {
      const picked = [...gs.options].find((o) => o.selected);
      if (picked && gcs(picked).backgroundColor === 'rgba(0, 0, 0, 0)') {
        note('选中项没上色，展开列表会落回系统灰', u.id, `#${gs.id} 选中项 background-color 透明`);
      }
    }
    // H 横向溢出 = 布局被压坏（零视口时整页会挤成 8px 宽）
    if (u.win.innerWidth > 600 && d.documentElement.scrollWidth > u.win.innerWidth + 4) {
      note('页面横向溢出', u.id, `scrollWidth ${d.documentElement.scrollWidth} > 视口 ${u.win.innerWidth}`);
    }
  }

  const t0 = Date.now();
  const prog = () => {
    window.__bpUiProgress = { 步: done, 共: STEPS, 违规: bad.length, 秒: Math.round((Date.now() - t0) / 1000) };
  };
  let done = 0;
  for (let i = 0; i < STEPS; i++) {
    const u = pick(frames);
    done++;
    prog();
    if (!u.doc || !u.win) continue;
    await act(u);
    await pace();
    check(u);
    if (u.errors.length) {
      for (const e of u.errors.splice(0)) note('页面抛异常', u.id, e);
    }
    if (i % 50 === 49) {
      // 中途让各帧各自重连一次，制造断线重连
      const who = pick(frames);
      if (who.doc) click(who, 'btn-reconnect');
    }
  }

  await new Promise((r) => setTimeout(r, 1200));
  for (const u of frames) {
    check(u);
    for (const e of u.errors.splice(0)) note('页面抛异常', u.id, e);
  }

  const summary = {
    seed: SEED,
    users: USERS,
    steps: STEPS,
    ms: Date.now() - t0,
    每帧状态: frames.map((u) => {
      if (!u.doc) return { id: u.id, dead: true };
      return {
        id: u.id,
        屏: u.doc.getElementById('screen-room')?.classList.contains('hidden') ? '大厅' : '房间',
        房号: u.doc.getElementById('room-code-hud')?.textContent || '',
        席位: [...u.doc.querySelectorAll('.seat')].length,
        状态: (u.doc.getElementById('lobby-status')?.textContent || '').trim().slice(0, 70),
      };
    }),
    违规数: bad.length,
    违规: bad.slice(0, 40),
  };
  host.remove();
  return JSON.stringify(summary, null, 1);
}
