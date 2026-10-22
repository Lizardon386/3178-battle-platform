export interface ChatLine {
  seatId: string;
  name: string;
  text: string;
  at: number;
  kind: 'say' | 'system';
}

export interface ChatPanelOptions {
  mount?: HTMLElement;
  max?: number;
  maxText?: number;
  showSystem?: boolean;
  placeholder?: string;
  sendLabel?: string;
  /** 覆盖默认发送方式；不填时在 iframe 里 parent.postMessage。 */
  onSend?: (text: string) => void;
  /** 新到的消息回调；初始历史不会触发。 */
  onLine?: (line: ChatLine) => void;
  /** 是否监听 window 的 bp:chat-history / bp:chat；有 mount 时默认开。 */
  listen?: boolean;
}

const MAX_CHAT_TEXT = 300;

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function chatText(value: string): string | null {
  const text = value.trim();
  if (text.length < 1 || text.length > MAX_CHAT_TEXT) return null;
  return text;
}

export function chatLineKey(line: ChatLine): string {
  return `${line.at}|${line.seatId}|${line.kind}|${line.text}`;
}

export function normalizeChatLine(value: unknown): ChatLine | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.seatId !== 'string' || typeof raw.name !== 'string') return null;
  if (typeof raw.text !== 'string' || typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return null;
  if (raw.kind !== 'say' && raw.kind !== 'system') return null;
  const text = raw.text.trim();
  if (!text || text.length > MAX_CHAT_TEXT) return null;
  return { seatId: raw.seatId, name: raw.name, text, at: raw.at, kind: raw.kind };
}

export function mergeChatLines(current: readonly ChatLine[], incoming: readonly ChatLine[], max: number): ChatLine[] {
  const byKey = new Map<string, ChatLine>();
  for (const line of current) byKey.set(chatLineKey(line), line);
  for (const line of incoming) byKey.set(chatLineKey(line), line);
  return [...byKey.values()].sort((a, b) => a.at - b.at).slice(-Math.max(1, max));
}

/** 房间聊天面板：历史以平台推送的 bp:chat-history 为准，发送只发纯文本。 */
export class ChatPanel {
  private readonly options: ChatPanelOptions;
  private readonly max: number;
  private readonly maxText: number;
  private readonly root: HTMLDivElement | null = null;
  private readonly log: HTMLOListElement | null = null;
  private readonly input: HTMLInputElement | null = null;
  private readonly form: HTMLFormElement | null = null;
  private readonly onChatHistory: ((event: Event) => void) | null = null;
  private readonly onChatLine: ((event: Event) => void) | null = null;
  private lines: ChatLine[] = [];

  constructor(options: ChatPanelOptions = {}) {
    this.options = options;
    this.max = clamp(options.max, 1, 500, 200);
    this.maxText = clamp(options.maxText, 1, MAX_CHAT_TEXT, MAX_CHAT_TEXT);
    if (options.mount) {
      const doc = options.mount.ownerDocument;
      const root = doc.createElement('div');
      root.className = 'bp-chat';
      root.style.cssText = 'display:flex;flex-direction:column;min-height:0;font:13px/1.5 system-ui, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
      const log = doc.createElement('ol');
      log.className = 'bp-chat-log';
      log.setAttribute('role', 'log');
      log.setAttribute('aria-live', 'polite');
      log.style.cssText = 'margin:0;padding:4px 8px;list-style:none;overflow-y:auto;flex:1 1 auto;min-height:120px;max-height:260px';
      const form = doc.createElement('form');
      form.className = 'bp-chat-form';
      form.style.cssText = 'display:flex;gap:6px;padding:6px 0 0';
      const input = doc.createElement('input');
      input.className = 'bp-chat-input';
      input.type = 'text';
      input.maxLength = MAX_CHAT_TEXT;
      input.autocomplete = 'off';
      input.placeholder = options.placeholder ?? '说点什么';
      input.style.cssText = 'flex:1 1 auto;min-width:0;padding:4px 6px';
      const button = doc.createElement('button');
      button.className = 'bp-chat-send';
      button.type = 'submit';
      button.textContent = options.sendLabel ?? '发送';
      button.style.cssText = 'flex:none;padding:4px 10px';
      form.append(input, button);
      root.append(log, form);
      options.mount.replaceChildren(root);
      this.root = root;
      this.log = log;
      this.input = input;
      this.form = form;
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.send();
      });
    }

    if (options.listen ?? Boolean(options.mount)) {
      if (typeof window !== 'undefined') {
        this.onChatHistory = (event: Event) => {
          const lines = (event as CustomEvent).detail;
          if (Array.isArray(lines)) this.setLines(lines as ChatLine[]);
        };
        this.onChatLine = (event: Event) => {
          this.append((event as CustomEvent).detail as ChatLine);
        };
        window.addEventListener('bp:chat-history', this.onChatHistory);
        window.addEventListener('bp:chat', this.onChatLine);
      }
    }
  }

  setLines(lines: readonly ChatLine[]): void {
    const normalized = lines.map(normalizeChatLine).filter((line): line is ChatLine => line !== null);
    this.lines = mergeChatLines([], normalized, this.max);
    this.render();
  }

  append(line: ChatLine): void {
    const normalized = normalizeChatLine(line);
    if (!normalized) return;
    if (this.lines.some((item) => chatLineKey(item) === chatLineKey(normalized))) return;
    this.lines = mergeChatLines(this.lines, [normalized], this.max);
    this.render();
    this.options.onLine?.(normalized);
  }

  send(): void {
    const input = this.input;
    if (!input) return;
    const text = chatText(input.value);
    if (!text) return;
    if (this.options.onSend) {
      this.options.onSend(text);
    } else if (typeof parent !== 'undefined' && parent !== window) {
      parent.postMessage({ type: 'chat', text }, '*');
    }
    input.value = '';
  }

  clear(): void {
    this.lines = [];
    this.render();
  }

  destroy(): void {
    if (typeof window !== 'undefined') {
      if (this.onChatHistory) window.removeEventListener('bp:chat-history', this.onChatHistory);
      if (this.onChatLine) window.removeEventListener('bp:chat', this.onChatLine);
    }
    this.options.mount?.replaceChildren();
    this.lines = [];
  }

  private render(): void {
    const log = this.log;
    if (!log) return;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 8;
    const allowed = this.options.showSystem === false ? this.lines.filter((line) => line.kind !== 'system') : this.lines;
    log.replaceChildren();
    for (const line of allowed) {
      const item = log.ownerDocument.createElement('li');
      item.className = `bp-chat-line bp-chat-${line.kind}`;
      item.dataset.seatId = line.seatId;
      item.style.cssText = 'padding:1px 0;overflow-wrap:anywhere';
      if (line.kind === 'system') {
        item.style.opacity = '0.65';
        item.textContent = line.text.length > this.maxText ? `${line.text.slice(0, this.maxText)}…` : line.text;
      } else {
        const name = log.ownerDocument.createElement('span');
        name.className = 'bp-chat-name';
        name.textContent = `${line.name}：`;
        name.style.cssText = 'font-weight:600;margin-right:2px';
        const text = log.ownerDocument.createElement('span');
        text.className = 'bp-chat-text';
        text.textContent = line.text.length > this.maxText ? `${line.text.slice(0, this.maxText)}…` : line.text;
        item.append(name, text);
      }
      log.append(item);
    }
    if (nearBottom) log.scrollTop = log.scrollHeight;
  }
}
