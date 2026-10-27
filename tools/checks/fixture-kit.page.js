/*
 * fixture-kit 浏览器检查：在已打开的大厅页面注入本函数。
 * 用法：navigate 到 http://127.0.0.1:3178/，再把整个函数体作为 evaluate_script 执行。
 * 宿主要先把 fixture-kit.bpmap 放进 games/ 并重启。
 * 结果返回 { ok, checks, reports }；页面变化失败时看 checks 里的中文项。
 */
async function bpFixtureKitCheck() {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const checks = [];
  const record = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail: detail || undefined });
  const reports = [];
  const onMessage = (event) => {
    if (event.data?.type === 'fixture-kit-report') reports.push(event.data.payload);
  };
  window.addEventListener('message', onMessage);

  const setInput = (id, value) => {
    const element = document.getElementById(id);
    if (!element) return false;
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const waitFor = async (predicate, timeout = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = predicate();
      if (value) return value;
      await sleep(80);
    }
    return null;
  };
  const probe = async (frame) => {
    reports.length = 0;
    frame.contentWindow?.postMessage({ type: 'fixture-kit-probe' }, '*');
    await sleep(350);
    return reports.at(-1);
  };

  try {
    record('页面在大厅', Boolean(document.getElementById('btn-create')));
    const trigger = [...document.querySelectorAll('button.bp-listbox-trigger')].find((button) =>
      button.textContent?.includes('测试夹具'),
    );
    trigger?.click();
    await sleep(120);
    const option = [...document.querySelectorAll('li.bp-listbox-option')].find((item) =>
      item.textContent?.includes('game-kit 界面'),
    );
    record('能选到 fixture-kit', Boolean(option));
    option?.click();
    await sleep(120);
    setInput('nick', '测试者');
    setInput('room-name', 'fixture-kit 检查');
    setInput('seat-slots', '2');
    document.getElementById('btn-create')?.click();

    const roomCode = await waitFor(() => document.getElementById('room-code-hud')?.textContent?.trim());
    record('建房后拿到房号', Boolean(roomCode), roomCode);

    const start = await waitFor(() => {
      const button = document.getElementById('btn-start');
      return button && !button.disabled ? button : null;
    });
    record('建房后能开局', Boolean(start));
    start?.click();

    const frame = await waitFor(() => {
      const node = document.querySelector('#game-host iframe');
      return node && !document.getElementById('game-host')?.classList.contains('hidden') ? node : null;
    }, 6000);
    record('游戏 iframe 已挂载', Boolean(frame));

    const first = frame ? await probe(frame) : null;
    record('ChatPanel 已渲染', Boolean(first?.hasChat), first?.title);
    record('ScoreboardPanel 已渲染', Boolean(first?.hasBoard), first?.boardRows?.join(' / '));
    record('FeedPanel 已渲染', Boolean(first?.hasFeed), first?.feedLines?.join(' / '));
    record('事件流有开局事件', Boolean(first?.feedLines?.some((line) => line.includes('game-kit 测试对局开始'))), first?.feedLines?.join(' / '));
    record('客户端资源已加载', Boolean(first?.assetText?.includes('SDK 夹具资源已加载')), first?.assetText);
    record('初始记分板有座位行', Boolean(first?.boardRows?.length), first?.boardRows?.join(' / '));
    record('system 消息进入游戏聊天', Boolean(first?.chatLines?.some((line) => line.includes('game-kit 测试对局开始'))));

    const chatPanel = document.getElementById('chat-panel');
    record('ui.chat=game 隐藏平台聊天卡', Boolean(chatPanel?.classList.contains('hidden')), chatPanel?.className);

    frame?.contentWindow?.postMessage({ type: 'fixture-kit-chat', text: '夹具聊天检查' }, '*');
    await sleep(700);
    const afterChat = frame ? await probe(frame) : null;
    record('游戏 ChatPanel 能发消息并回显', Boolean(afterChat?.chatLines?.some((line) => line.includes('夹具聊天检查'))), afterChat?.chatLines?.join(' / '));

    frame?.contentWindow?.postMessage({ type: 'fixture-kit-bump' }, '*');
    await sleep(700);
    const afterBump = frame ? await probe(frame) : null;
    record('下一手动作更新记分板', Boolean(afterBump?.boardRows?.length && afterBump.boardRows.join('|') !== first?.boardRows?.join('|')), afterBump?.boardRows?.join(' / '));
    record('下一手动作进入事件流', Boolean(afterBump?.feedLines?.some((line) => line.includes('推进到第'))), afterBump?.feedLines?.join(' / '));

    frame?.contentWindow?.postMessage({ type: 'fixture-kit-reject' }, '*');
    await sleep(700);
    const barText = document.getElementById('connection-bar')?.textContent ?? '';
    record('非法动作在平台状态栏显示拒绝', barText.includes('game-kit 夹具拒绝这个动作'), barText);

    document.getElementById('btn-add-ai')?.click();
    await sleep(700);
    const afterAi = frame ? await probe(frame) : null;
    record('加电脑位后记分板出现电脑行', Boolean(afterAi?.boardRows?.some((row) => row.includes('电脑'))), afterAi?.boardRows?.join(' / '));
    record('对局中平台聊天卡仍隐藏', Boolean(document.getElementById('chat-panel')?.classList.contains('hidden')));

    return {
      ok: checks.every((item) => item.ok),
      checks,
      reports: { first, afterChat, afterBump, afterAi },
    };
  } catch (error) {
    record('检查脚本未抛异常', false, error instanceof Error ? error.message : String(error));
    return { ok: false, checks, reports: { last: reports.at(-1) } };
  } finally {
    window.removeEventListener('message', onMessage);
  }
}
