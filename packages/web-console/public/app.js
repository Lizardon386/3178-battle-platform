const $ = (id) => document.getElementById(id);
const logEl = $('log');
const statusEl = $('status');
const sessionEl = $('session');
const viewEl = $('view');
const handEl = $('hand');
const gameEl = $('game');

let control = null;
let data = null;
let sessionId = null;
let code = null;
let memberId = null;
let channelId = null;
let seq = 0;

const log = (text, value) => {
  const line = value === undefined ? text : `${text} ${JSON.stringify(value, null, 2)}`;
  logEl.textContent = `${line}\n${logEl.textContent}`.slice(0, 8000);
};

const setStatus = (text, kind) => {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` ${kind}` : ''}`;
};

const send = (message) => {
  if (!control || control.readyState !== 1) {
    log('控制连接未就绪');
    return;
  }
  control.send(JSON.stringify(message));
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
  const payload = new TextDecoder().decode(bytes.subarray(4 + headerLength));
  return { header, payload: JSON.parse(payload) };
};

const renderSession = (session) => {
  sessionEl.textContent = JSON.stringify({
    sessionId: session.sessionId,
    code: session.code,
    gameProcess: session.gameProcess,
    authorityEpoch: session.authorityEpoch,
    members: session.members.map((m) => ({ id: m.memberId, presence: m.presence, slot: m.slot })),
  }, null, 2);
  $('start').disabled = session.gameProcess !== 'stopped';
  $('recover').disabled = session.gameProcess !== 'failed';
};

const renderPayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    log('游戏消息', payload);
    return;
  }
  if (payload.type === 'public') {
    const view = payload.view;
    viewEl.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'muted';
    line.textContent = `回合 ${view.turnNumber} · 当前 ${view.currentMemberId}${view.finished ? ` · 结束：${view.winner ?? '平局'}` : ''}`;
    viewEl.append(line);
    const players = document.createElement('div');
    players.className = 'players';
    for (const player of view.players) {
      const card = document.createElement('div');
      card.className = `player${player.memberId === memberId ? ' me' : ''}`;
      card.textContent = `${player.memberId} · HP ${player.hp} · 盾 ${player.shield} · 手牌 ${player.handCount}`;
      players.append(card);
    }
    viewEl.append(players);
    return;
  }
  if (payload.type === 'private') {
    handEl.innerHTML = '';
    for (const card of payload.view.hand) {
      const button = document.createElement('button');
      button.className = 'card';
      button.textContent = card.kind;
      button.onclick = () => play(card.id);
      handEl.append(button);
    }
    return;
  }
  if (payload.type === 'rejected') {
    log(`动作被拒：${payload.code} ${payload.message}`);
    return;
  }
  log('游戏消息', payload);
};

const play = (cardId) => {
  if (!data || data.readyState !== 1) return;
  seq += 1;
  const payload = new TextEncoder().encode(JSON.stringify({ action: { type: 'play', cardId } }));
  data.send(encodeFrame({
    v: 1, channelId: channelId ?? 'console', to: 'all', seq, mode: 'reliable', payloadBytes: payload.length,
  }, payload));
};

const connectData = () => {
  if (data) data.close();
  data = new WebSocket(`ws://${location.host}/ws/data`);
  data.binaryType = 'arraybuffer';
  data.onopen = () => {
    data.send(JSON.stringify({ kind: 'data', channelToken: $('channel').dataset.token }));
  };
  data.onmessage = (event) => {
    if (typeof event.data === 'string') {
      const message = JSON.parse(event.data);
      if (message.type === 'dataReady') {
        channelId = message.channelId;
        setStatus('数据通道已就绪', 'ok');
        log('数据通道已就绪', channelId);
      }
      return;
    }
    try {
      renderPayload(decodeFrame(event.data).payload);
    } catch (error) {
      log(`坏帧：${String(error)}`);
    }
  };
};

const connectControl = () => {
  control = new WebSocket(`ws://${location.host}/ws/control`);
  control.onopen = () => send({ type: 'hello' });
  control.onmessage = (event) => {
    const message = JSON.parse(event.data);
    switch (message.type) {
      case 'welcome':
        setStatus('已连接', 'ok');
        break;
      case 'seatGranted':
        sessionId = message.sessionId;
        code = message.code;
        memberId = message.memberId;
        setStatus(`已入座 ${message.memberId} · 房号 ${message.code}`, 'ok');
        log('入座', { sessionId, code, memberId });
        break;
      case 'sessionState':
        renderSession(message.session);
        break;
      case 'channelGranted':
        $('channel').dataset.token = message.channelToken;
        if (message.gameUrl) {
          gameEl.replaceChildren();
          const link = document.createElement('a');
          link.href = message.gameUrl;
          link.target = '_blank';
          link.rel = 'noreferrer';
          link.textContent = '打开游戏页面';
          gameEl.append(link);
          log('游戏地址', message.gameUrl);
        }
        connectData();
        break;
      case 'error':
        setStatus(`错误 ${message.code}：${message.text}`, 'bad');
        log(`错误 ${message.code}`, message.text);
        break;
      default:
        log(message.type, message);
    }
  };
  control.onclose = () => setStatus('连接已断开', 'bad');
};

$('create').onclick = () => {
  send({
    type: 'sessionCreate',
    gameId: $('gameId').value.trim(),
    gameVersion: $('gameVersion').value.trim(),
    inviteSecret: $('inviteSecret').value.trim() || undefined,
  });
};

$('join').onclick = () => {
  const targetSession = prompt('会话 ID', sessionId ?? '');
  if (!targetSession) return;
  const targetCode = prompt('房号', code ?? '');
  if (!targetCode) return;
  send({
    type: 'sessionJoin',
    sessionId: targetSession,
    code: targetCode,
    inviteSecret: $('inviteSecret').value.trim() || undefined,
  });
};

$('start').onclick = () => send({ type: 'startGame' });
$('recover').onclick = () => send({ type: 'recoverGame' });
$('channel').onclick = () => send({ type: 'channelOpen' });

connectControl();
