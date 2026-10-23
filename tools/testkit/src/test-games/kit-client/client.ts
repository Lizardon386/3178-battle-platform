import { ChatPanel, ScoreboardPanel } from '@bp/game-sdk/kit';

let board: ScoreboardPanel | null = null;
let chat: ChatPanel | null = null;
let title: HTMLHeadingElement | null = null;

export default {
  mount(host: HTMLElement, view: unknown, actions: { send(name: string): void }) {
    const state = view as {
      title?: string;
      viewer?: string | null;
      scoreboard?: { rows: Array<{ seatId: string; values: Record<string, unknown> }> };
    };
    if (!board) {
      host.replaceChildren();
      const wrap = document.createElement('div');
      wrap.dataset.fixture = 'game-kit';
      wrap.style.cssText = 'padding:12px;color:#e8e8ed;font:13px/1.5 system-ui,"Microsoft YaHei UI",sans-serif';
      title = document.createElement('h1');
      title.id = 'fixture-kit-title';
      title.style.cssText = 'font-size:16px;margin:0 0 8px';
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
      const bump = document.createElement('button');
      bump.id = 'fixture-kit-bump';
      bump.textContent = '下一手';
      bump.addEventListener('click', () => actions.send('bump'));
      bar.append(bump);
      const boardEl = document.createElement('div');
      const chatEl = document.createElement('div');
      chatEl.style.cssText = 'margin-top:12px;max-width:520px';
      wrap.append(title, bar, boardEl, chatEl);
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
      chat = new ChatPanel({ mount: chatEl, showSystem: true });
    }
    if (title) title.textContent = `${state.title ?? ''}${state.viewer ? ` · ${state.viewer}` : ''}`;
    board.setRows(state.scoreboard?.rows ?? []);
  },
  unmount(host: HTMLElement) {
    board?.destroy();
    chat?.destroy();
    board = null;
    chat = null;
    title = null;
    host.replaceChildren();
  },
};
