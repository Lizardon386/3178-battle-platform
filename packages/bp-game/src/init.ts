import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { validateManifest } from '@bp/game-package';

export interface InitGameOptions {
  dir: string;
  id?: string;
  name?: string;
  force?: boolean;
}

export interface InitGameResult {
  dir: string;
  id: string;
  files: string[];
}

const AUTHORITY = `import net from 'node:net';

function encode(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const frame = Buffer.alloc(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

function decode(buffer) {
  const messages = [];
  let offset = 0;
  while (buffer.length - offset >= 4) {
    const length = buffer.readUInt32BE(offset);
    if (length <= 0 || buffer.length - offset - 4 < length) break;
    messages.push(JSON.parse(buffer.subarray(offset + 4, offset + 4 + length).toString('utf8')));
    offset += 4 + length;
  }
  return { messages, rest: buffer.subarray(offset) };
}

let boot = null;
let socket = null;
let incoming = Buffer.alloc(0);
const viewSeq = new Map();
let state = { roundId: '', seq: 0 };

function send(message) {
  if (socket) socket.write(encode(message));
}

function deliver(target, payload) {
  const next = (viewSeq.get(target) || 0) + 1;
  viewSeq.set(target, next);
  return { to: target, payload, viewSeq: next };
}

function publish() {
  const view = { roundId: state.roundId, seq: state.seq };
  const items = [deliver('all', { type: 'public', view })];
  for (const member of boot.members) items.push(deliver(member.memberId, { type: 'private', view: { ...view, you: member.memberId } }));
  send({ type: 'deliver', authorityEpoch: boot.epoch, roundId: state.roundId, gameSequence: state.seq, items });
}

function handle(message) {
  if (message.type === 'ping') {
    send({ type: 'pong', nonce: message.nonce });
    return;
  }
  if (message.type === 'sync') {
    const view = { roundId: state.roundId, seq: state.seq };
    send({
      type: 'deliver', authorityEpoch: boot.epoch, roundId: state.roundId, gameSequence: state.seq,
      items: [
        deliver(message.memberId, { type: 'public', view }),
        deliver(message.memberId, { type: 'private', view: { ...view, you: message.memberId } }),
      ],
    });
    return;
  }
  if (message.type === 'startRound') {
    state = { roundId: String(message.roundId), seq: 0 };
    publish();
    return;
  }
  if (message.type === 'deliver') {
    const action = message.payload && message.payload.action;
    if (!action || action.type !== 'tick') {
      send({
        type: 'deliver', authorityEpoch: boot.epoch, roundId: state.roundId, gameSequence: state.seq,
        items: [deliver(message.fromMemberId, { type: 'rejected', code: 'ACTION', message: '只支持 tick' })],
      });
      return;
    }
    state.seq += 1;
    publish();
  }
}

process.stdin.on('data', (chunk) => {
  incoming = Buffer.concat([incoming, chunk]);
  const index = incoming.indexOf(10);
  if (index < 0 || boot) return;
  boot = JSON.parse(incoming.subarray(0, index).toString('utf8'));
  state.roundId = boot.roundId;
  socket = net.connect(boot.ipcPath, () => {
    send({ type: 'authorityReady', authorityEpoch: boot.epoch });
    publish();
  });
  let buffer = Buffer.alloc(0);
  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    const decoded = decode(buffer);
    buffer = decoded.rest;
    for (const message of decoded.messages) handle(message);
  });
  socket.on('close', () => process.exit(0));
});
`;

const WEB_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>我的游戏</title>
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <main>
    <h1>我的游戏</h1>
    <p id="status" class="status" role="status" aria-live="polite">连接中…</p>
    <p><span>回合</span> <strong id="round">—</strong></p>
    <p><span>序号</span> <strong id="seq">—</strong></p>
    <button id="tick" type="button">推进一次</button>
    <ol id="log" class="log"></ol>
  </main>
  <script type="module" src="./main.js"></script>
</body>
</html>
`;

const WEB_JS = `const $ = (id) => document.getElementById(id);
const handoff = new URLSearchParams(location.hash.slice(1)).get('handoff');
history.replaceState(null, '', location.pathname);

const encode = (header, payload) => {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + headerBytes.length + payload.length);
  new DataView(out.buffer).setUint32(0, headerBytes.length, false);
  out.set(headerBytes, 4);
  out.set(payload, 4 + headerBytes.length);
  return out;
};

const decode = (buffer) => {
  const bytes = new Uint8Array(buffer);
  const headerLength = new DataView(bytes.buffer).getUint32(0, false);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength)));
  return { header, payload: JSON.parse(new TextDecoder().decode(bytes.subarray(4 + headerLength))) };
};

let socket = null;
let channelId = null;
let seq = 0;

const log = (text) => {
  const item = document.createElement('li');
  item.textContent = text;
  $('log').prepend(item);
};

const render = (payload) => {
  if (payload.type === 'public' || payload.type === 'private') {
    $('round').textContent = payload.view.roundId;
    $('seq').textContent = payload.view.seq;
    $('status').textContent = '已连接';
  } else if (payload.type === 'rejected') {
    log('动作被拒：' + payload.code + ' ' + payload.message);
  }
};

const connect = () => {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(scheme + '://' + location.host + '/ws/data');
  socket.binaryType = 'arraybuffer';
  socket.onopen = () => socket.send(JSON.stringify({ kind: 'data', handoffCode: handoff }));
  socket.onmessage = (event) => {
    if (typeof event.data === 'string') {
      const message = JSON.parse(event.data);
      if (message.type === 'dataReady') {
        channelId = message.channelId;
        $('status').textContent = '已连接，等待视图';
      } else if (message.type === 'error') {
        $('status').textContent = '错误 ' + message.code + '：' + message.text;
      }
      return;
    }
    render(decode(event.data).payload);
  };
  socket.onclose = () => { $('status').textContent = '连接已断开'; };
};

$('tick').onclick = () => {
  if (!socket || socket.readyState !== 1 || !channelId) return;
  seq += 1;
  const payload = new TextEncoder().encode(JSON.stringify({ action: { type: 'tick' } }));
  socket.send(encode({ v: 1, channelId, to: 'all', seq, mode: 'reliable', payloadBytes: payload.length }, payload));
};

if (!handoff) {
  $('status').textContent = '缺少交接码，请从房间页打开';
} else {
  connect();
}
`;

const WEB_CSS = `:root { color-scheme: dark; --bg: #12151c; --panel: #1b202b; --text: #e6e9f2; --dim: #8b93a7; --accent: #6ea8fe; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); font: 15px/1.55 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
main { max-width: 640px; margin: 0 auto; padding: 32px 20px; }
h1 { font-size: 24px; }
.status { color: var(--dim); }
button { min-height: 40px; padding: 8px 16px; border: 1px solid #2b3242; border-radius: 8px; background: var(--accent); color: #08111f; font: inherit; cursor: pointer; }
button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.log { margin-top: 20px; padding-left: 20px; color: var(--dim); }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
@media (prefers-contrast: more) { :root { --bg: #000; --panel: #0b0b10; --text: #fff; --dim: #e6e6e6; } }
`;

const slug = (value: string): string => {
  const result = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').replace(/-+$/, '');
  return result.slice(0, 64) || 'my-game';
};

export async function initGame(options: InitGameOptions): Promise<InitGameResult> {
  const dir = resolve(options.dir);
  const id = options.id ?? slug(basename(dir));
  const name = options.name ?? basename(dir);
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    // 目录不存在，正常创建
  }
  if (entries.length > 0 && !options.force) throw new Error(`目录非空，使用 --force 覆盖：${dir}`);

  const manifest = {
    id,
    name,
    version: '0.1.0',
    lateJoin: 'spectator',
    platformRequirements: { protocolVersion: 1, minPlayers: 2, maxPlayers: 4, allowSpectate: true },
    entryPoints: { authority: 'authority/index.js', web: 'web/index.html' },
    sessionConfig: { fields: [] },
    reference: { entry: 'reference.json' },
  };
  const reference = {
    id,
    name,
    version: '0.1.0',
    rules: ['点击“推进一次”让序号 +1；这是最小可运行模板。'],
  };
  const files: Array<[string, string]> = [
    ['game.manifest.json', `${JSON.stringify(manifest, null, 2)}\n`],
    // 让 esbuild 把模板 Authority 当 ESM 解析，避免 node:net 被包成动态 require。
    ['package.json', `${JSON.stringify({ name: id, private: true, type: 'module' }, null, 2)}\n`],
    ['src/authority/process.js', AUTHORITY],
    ['src/web/index.html', WEB_HTML],
    ['src/web/main.js', WEB_JS],
    ['src/web/style.css', WEB_CSS],
    ['src/reference.json', `${JSON.stringify(reference, null, 2)}\n`],
  ];
  for (const [relative, content] of files) {
    const file = join(dir, ...relative.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
  }
  // 校验清单能过平台规则；失败会直接抛错，避免生成不可用模板。
  validateManifest(manifest);
  return { dir, id, files: files.map(([relative]) => relative) };
}
