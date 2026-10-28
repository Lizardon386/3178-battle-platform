import { ChatPanel, FeedPanel, ScoreboardPanel } from '@lizardon386/game-sdk/kit';
import type { FeedEntry } from '@lizardon386/game-sdk/kit';

let board: ScoreboardPanel | null = null;
let chat: ChatPanel | null = null;
let feed: FeedPanel | null = null;
let title: HTMLHeadingElement | null = null;
let assetText = '';
let assetLoading = false;

function report(): void {
  const root = document.querySelector('[data-fixture="game-kit"]');
  parent.postMessage({
    type: 'fixture-kit-report',
    payload: {
      title: title?.textContent ?? '',
      hasBoard: Boolean(root?.querySelector('.bp-scoreboard')),
      hasChat: Boolean(root?.querySelector('.bp-chat')),
      hasFeed: Boolean(root?.querySelector('.bp-feed')),
      boardRows: [...(root?.querySelectorAll('.bp-scoreboard tbody tr') ?? [])].map((row) => row.textContent ?? ''),
      chatLines: [...(root?.querySelectorAll('.bp-chat-line') ?? [])].map((line) => line.textContent ?? ''),
      feedLines: [...(root?.querySelectorAll('.bp-feed .bp-feed-text') ?? [])].map((line) => line.textContent ?? ''),
      assetText,
    },
  }, '*');
}

function loadAsset(element: HTMLElement): void {
  if (assetLoading) return;
  if (assetText) {
    element.textContent = assetText;
    return;
  }
  assetLoading = true;
  element.textContent = '资源加载中…';
  fetch('assets/notice.json', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<{ text?: unknown }>;
    })
    .then((data) => {
      assetText = typeof data.text === 'string' ? data.text : '资源已加载';
      element.textContent = assetText;
      report();
    })
    .catch((error: unknown) => {
      assetText = `资源加载失败：${String(error)}`;
      element.textContent = assetText;
      report();
    })
    .finally(() => {
      assetLoading = false;
    });
}

window.addEventListener('message', (event) => {
  if (event.source !== parent) return;
  const data = event.data as { type?: string; text?: string } | null;
  if (!data) return;
  if (data.type === 'fixture-kit-probe') report();
  if (data.type === 'fixture-kit-chat' && typeof data.text === 'string') {
    const input = document.querySelector<HTMLInputElement>('.bp-chat-input');
    if (input) input.value = data.text;
    chat?.send();
  }
  if (data.type === 'fixture-kit-bump') {
    document.querySelector<HTMLButtonElement>('#fixture-kit-bump')?.click();
  }
  if (data.type === 'fixture-kit-reject') {
    document.querySelector<HTMLButtonElement>('#fixture-kit-reject')?.click();
  }
});

export default {
  mount(host: HTMLElement, view: unknown, actions: { send(name: string): void }) {
    const state = view as {
      title?: string;
      viewer?: string | null;
      scoreboard?: { rows: Array<{ seatId: string; values: Record<string, unknown> }> };
      feed?: FeedEntry[];
    };
    if (!board) {
      host.replaceChildren();
      const wrap = document.createElement('div');
      wrap.dataset.fixture = 'game-kit';
      wrap.style.cssText = 'padding:12px;color:#e8e8ed;font:13px/1.5 system-ui,"Microsoft YaHei UI",sans-serif';
      title = document.createElement('h1');
      title.id = 'fixture-kit-title';
      title.style.cssText = 'font-size:16px;margin:0 0 8px';
      const asset = document.createElement('p');
      asset.id = 'fixture-kit-asset';
      asset.style.cssText = 'margin:0 0 8px;font-size:12px;opacity:.75';
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
      const bump = document.createElement('button');
      bump.id = 'fixture-kit-bump';
      bump.textContent = '下一手';
      bump.addEventListener('click', () => actions.send('bump'));
      const rejectButton = document.createElement('button');
      rejectButton.id = 'fixture-kit-reject';
      rejectButton.textContent = '触发拒绝';
      rejectButton.addEventListener('click', () => actions.send('fixture-reject'));
      bar.append(bump, rejectButton);
      const boardEl = document.createElement('div');
      const feedEl = document.createElement('div');
      feedEl.style.cssText = 'margin-top:8px';
      const chatEl = document.createElement('div');
      chatEl.style.cssText = 'margin-top:12px;max-width:520px';
      wrap.append(title, asset, bar, boardEl, feedEl, chatEl);
      host.append(wrap);
      board = new ScoreboardPanel({
        mount: boardEl,
        columns: [
          { key: 'score', label: '分数' },
          { key: 'hand', label: '手牌' },
          { key: 'state', label: '状态' },
        ],
        showTeam: true,
        showConnection: true,
      });
      feed = new FeedPanel({ mount: feedEl, max: 50 });
      chat = new ChatPanel({ mount: chatEl, showSystem: true });
      loadAsset(asset);
    }
    if (title) title.textContent = `${state.title ?? ''}${state.viewer ? ` · ${state.viewer}` : ''}`;
    board.setRows(state.scoreboard?.rows ?? []);
    feed?.setEntries(state.feed ?? []);
    setTimeout(report, 80);
  },
  onEvent(event: { name: string; payload?: unknown }) {
    feed?.handleEvent(event);
  },
  unmount(host: HTMLElement) {
    board?.destroy();
    chat?.destroy();
    feed?.destroy();
    board = null;
    chat = null;
    feed = null;
    title = null;
    host.replaceChildren();
  },
};
