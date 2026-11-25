const $ = (id) => document.getElementById(id);
const CARD_LABEL = { strike: '斩击', shield: '护盾', drain: '汲取', draw: '过牌' };

const statusEl = $('status');
const playersEl = $('players');
const handEl = $('hand');
const logEl = $('log');

let socket = null;
let channelId = null;
let seq = 0;
let me = null;
let publicView = null;
let hand = [];

const hash = new URLSearchParams(location.hash.slice(1));
const handoffCode = hash.get('handoff');
// 交接码只放在 fragment；连上之前先从地址栏抹掉，避免被复制或进入历史。
history.replaceState(null, '', location.pathname);

const setStatus = (text, kind) => {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` ${kind}` : ''}`;
};

const encodeFrame = (header, payload) => {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + headerBytes.length + payload.length);
  new DataView(out.buffer).setUint32(0, headerBytes.length, false);
  out.set(headerBytes, 4);
  out.set(payload, 4 + headerBytes.length);
  return out;
};

const decodeFrame = (buffer) => {
  const bytes = new Uint8Array(buffer);
  const headerLength = new DataView(bytes.buffer).getUint32(0, false);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength)));
  const payload = JSON.parse(new TextDecoder().decode(bytes.subarray(4 + headerLength)));
  return { header, payload };
};

const myTurn = () => Boolean(publicView && me && !publicView.finished && publicView.currentMemberId === me);

const renderPlayers = () => {
  playersEl.replaceChildren();
  if (!publicView) return;
  for (const player of publicView.players) {
    const card = document.createElement('article');
    card.className = `player${player.memberId === me ? ' me' : ''}${player.memberId === publicView.currentMemberId ? ' turn' : ''}`;
    const name = document.createElement('h2');
    name.textContent = player.memberId === me ? `${player.memberId}（你）` : player.memberId;
    const stats = document.createElement('p');
    stats.textContent = `HP ${player.hp} · 护盾 ${player.shield} · 手牌 ${player.handCount} · 牌库 ${player.deckCount}`;
    card.append(name, stats);
    playersEl.append(card);
  }
  const subtitle = document.createElement('p');
  subtitle.className = 'muted';
  subtitle.textContent = `回合 ${publicView.turnNumber} · 当前 ${publicView.currentMemberId}`
    + (publicView.finished ? ` · 结束：${publicView.winner ?? '平局'}（${publicView.reason ?? ''}）` : '');
  playersEl.append(subtitle);
};

const renderHand = () => {
  handEl.replaceChildren();
  const enabled = myTurn();
  for (const card of hand) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card';
    button.textContent = CARD_LABEL[card.kind] ?? card.kind;
    button.disabled = !enabled;
    button.onclick = () => sendAction({ type: 'play', cardId: card.id });
    handEl.append(button);
  }
  if (hand.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = publicView?.finished ? '对局结束' : '没有手牌';
    handEl.append(empty);
  }
  $('concede').disabled = !publicView || publicView.finished;
};

const renderLog = () => {
  logEl.replaceChildren();
  for (const line of (publicView?.log ?? []).slice(-12)) {
    const item = document.createElement('li');
    item.textContent = line;
    logEl.append(item);
  }
};

const renderPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return;
  if (payload.type === 'public') {
    publicView = payload.view;
    renderPlayers();
    renderHand();
    renderLog();
    setStatus(publicView.finished ? '对局结束' : myTurn() ? '轮到你出牌' : '等待对手', publicView.finished ? '' : 'ok');
    return;
  }
  if (payload.type === 'private') {
    me = payload.view.you;
    hand = payload.view.hand;
    renderPlayers();
    renderHand();
    return;
  }
  if (payload.type === 'rejected') {
    setStatus(`动作被拒：${payload.code} ${payload.message}`, 'bad');
  }
};

const sendAction = (action) => {
  if (!socket || socket.readyState !== 1 || !channelId) return;
  seq += 1;
  const payload = new TextEncoder().encode(JSON.stringify({ action }));
  socket.send(encodeFrame({
    v: 1, channelId, to: 'all', seq, mode: 'reliable', payloadBytes: payload.length,
  }, payload));
};

const connect = () => {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${scheme}://${location.host}/ws/data`);
  socket.binaryType = 'arraybuffer';
  socket.onopen = () => socket.send(JSON.stringify({ kind: 'data', handoffCode }));
  socket.onmessage = (event) => {
    if (typeof event.data === 'string') {
      const message = JSON.parse(event.data);
      if (message.type === 'dataReady') {
        channelId = message.channelId;
        setStatus('已连接，等待房间状态', 'ok');
      } else if (message.type === 'error') {
        setStatus(`错误 ${message.code}：${message.text}`, 'bad');
      }
      return;
    }
    try {
      renderPayload(decodeFrame(event.data).payload);
    } catch (error) {
      setStatus(`坏帧：${String(error)}`, 'bad');
    }
  };
  socket.onclose = (event) => setStatus(`连接已断开（${event.code}）`, 'bad');
  socket.onerror = () => setStatus('连接失败', 'bad');
};

$('concede').onclick = () => sendAction({ type: 'concede' });

if (!handoffCode) {
  setStatus('缺少交接码，请从房间页重新打开游戏', 'bad');
} else {
  connect();
}
