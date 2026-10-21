#!/usr/bin/env node
/**
 * 协议层猴测：多开 N 个模拟用户，随机（含故意非法）地打宿主壳，
 * 每收到一帧就跑一遍不变式检查。中途可以随机重启房主端，逼客户端走"重连坐回原位"。
 *
 *   node tools/checks/monkey.mjs --seed 7 --users 6 --steps 600 --restarts 2
 *
 * 任何违规都会打印 seed + 那个用户的完整动作/帧轨迹，照 seed 重跑即可复现。
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { PLATFORM_CODES, NOTICE_CODES } from '../../packages/protocol/dist/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const SEED = Number(arg('seed', String(Date.now() % 100000)));
const USERS = Number(arg('users', '6'));
const STEPS = Number(arg('steps', '600'));
const RESTARTS = Number(arg('restarts', '2'));
const PORT = Number(arg('port', '3500'));
const RUN_STARTED_AT = Date.now(); // 收尾只删这次运行写过的盘上文件，用户更早的房一个都不碰
const ORIGIN = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;

// mulberry32：可复现的伪随机，seed 就是复现凭证
let s = SEED >>> 0;
function rnd() {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const pendingTimers = [];
const violations = [];
const stats = { sent: 0, frames: 0, errors: {}, notices: {}, restarts: 0, resumes: 0 };

function fail(kind, user, detail) {
  violations.push({
    kind,
    user: user ? user.id : '-',
    detail,
    trace: user ? user.trace.slice(-24) : [],
    events: user ? user.events.slice(-30) : [],
    frames: user ? user.frameLog.slice(-16) : [],
  });
}

// ---------------- 房主端子进程 ----------------

let shell = null;
let shellLog = '';

function startShell() {
  shell = spawn(process.execPath, [join(ROOT, 'packages/hostd/dist/cli.js'), 'host', '--port', String(PORT), '--no-lan'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  shell.stdout.on('data', (b) => (shellLog += b.toString()));
  shell.stderr.on('data', (b) => (shellLog += b.toString()));
  shell.on('exit', (code, signal) => {
    if (!plannedExit) fail('房主端意外退出', null, `exit=${code} signal=${signal}\n${shellLog.slice(-1500)}`);
  });
}
let plannedExit = false;

async function waitHealth(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${ORIGIN}/health`, { signal: AbortSignal.timeout(400) });
      if (r.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

async function restartShell() {
  plannedExit = true;
  shell?.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 400));
  startShell();
  plannedExit = false;
  if (!(await waitHealth(12_000))) fail('重启后起不来', null, shellLog.slice(-1200));
  stats.restarts++;
}

// ---------------- 模拟用户 ----------------

const NICKS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];

class User {
  constructor(id) {
    this.id = id;
    this.nick = `猴${id}${NICKS[id % NICKS.length]}`;
    this.seatId = null;
    this.ticket = null;
    this.code = null;
    this.role = null;
    this.revision = -1;
    this.phase = null;
    this.trace = [];
    this.events = [];
    this.frameLog = [];
    this.ws = null;
    this.pendingIntent = 'valid';
    this.awaitingResume = false;
    this.pendingResume = null;
    // 故意非法的帧会有回信，但回信到达时"最后一发是什么"早就被后面的合法帧覆盖了。
    // 没有这个计数的话，合法帧会背上非法帧的 NOSEAT——第一版台子就是这么误报的。
    this.pendingInvalid = 0;
  }

  connect() {
    // 先掐掉上一条：不关的话一个"用户"会同时挂好几条活连接抢同一个座位，
    // 服务端要走完"旧连接关闭 → 座位归属判定"这套时序，台子却把它当一个人。
    try {
      this.ws?.close();
    } catch {
      /* 已经关了 */
    }
    const my = new WebSocket(WS_URL, { maxPayload: 1 << 20 });
    this.ws = my;
    my.on('open', () => {
      if (this.ws !== my) return; // 已经换下一代连接了
      this.raw(
        { type: 'hello', protocol: 1, nick: this.nick, gameId: 'fixture-turn' },
        'hello',
      );
    });
    my.on('message', (buf) => {
      // 分代守卫：旧连接的回信不能算到当前状态头上——否则重启前那发"假票据"的 NOSEAT
      // 会晚到一步，正好落在真票据 resume 之后，被误判成"真票据被拒"。
      if (this.ws !== my) return;
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        fail('收到非 JSON 帧', this, buf.toString().slice(0, 200));
        return;
      }
      this.onFrame(msg);
    });
    my.on('error', () => { /* 断线由 restart 触发，忽略 */ });
  }

  raw(payload, label, intent = 'valid') {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.pendingIntent = intent;
    if (intent === 'invalid') this.pendingInvalid += 1;
    this.trace.push({ sent: label, state: this.brief(), intent });
    this.events.push(`> ${label} [${this.brief()}]${intent === 'invalid' ? '(故意)' : ''}`);
    stats.sent++;
    this.ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return true;
  }

  brief() {
    return `${this.code ?? '-'}:${this.seatId ?? '无座'}:${this.role ?? '-'}`;
  }

  onFrame(msg) {
    stats.frames++;
    this.frameLog.push(`${msg.type}${msg.code ? '/' + msg.code : ''}${msg.revision !== undefined ? '#' + msg.revision : ''}`);
    this.events.push(`< ${msg.type}${msg.code ? '/' + msg.code : ''}${msg.revision !== undefined ? '#' + msg.revision : ''}`);
    this.check(msg);
    if (msg.type === 'welcome') {
      // 与 app.ts 一致：收到 welcome 立刻用票据坐回原位，不留"新连接还没座位"的空窗
      if (this.pendingResume) {
        const r = this.pendingResume;
        this.pendingResume = null;
        this.raw({ type: 'seatResume', code: r.code, seatId: r.seatId, ticket: r.ticket }, 'seatResume(真票据)');
      }
    }
    if (msg.type === 'seatGranted') {
      this.awaitingResume = false;
      this.seatId = msg.seatId;
      this.ticket = msg.ticket;
      this.code = msg.code;
      this.role = msg.role;
      this.revision = -1;
      // 换了一个房就是从新开始，别拿上一个房的 playing 来判这个房"相位倒退"
      this.phase = null;
    }
    if (msg.type === 'snapshot' && msg.room) {
      this.phase = msg.room.phase;
      // 权威判据：快照里的座位表没有我，就是已经不在席（自己离的、被踢的、被顶的都算）。
      // 不这么判的话，台子会在 seatLeave 之后继续拿旧 seatId 发合法帧，然后把服务端正确的 NOSEAT 报成违规。
      if (this.seatId && Array.isArray(msg.seats) && !msg.seats.some((x) => x.seatId === this.seatId)) {
        this.seatId = null;
        this.role = null;
        this.code = null;
        this.ticket = null;
      }
    }
    if (msg.type === 'error' && (msg.code === 'NOROOM' || msg.code === 'ROOM_GONE')) {
      if (msg.code === 'NOROOM') {
        this.seatId = null;
        this.ticket = null;
        this.code = null;
        this.role = null;
      }
    }
    if (msg.type === 'notice' && (msg.code === 'SEAT_EJECTED' || msg.code === 'HOSTLEFT' || msg.code === 'ROOM_CLOSED')) {
      this.seatId = null;
      this.role = null;
    }
  }

  check(msg) {
    const u = this;
    // 错误码与通知码必须来自目录，且带中文文案
    if (msg.type === 'error') {
      stats.errors[msg.code] = (stats.errors[msg.code] ?? 0) + 1;
      if (this.awaitingResume) {
        if (msg.code === 'NOSEAT') fail('真票据被拒', u, `seat=${this.seatId} code=${this.code} 却被判无座位`);
        else if (msg.code === 'NOROOM') this.awaitingResume = false; // 房确实没了，可以接受
      }
      if (!PLATFORM_CODES.includes(msg.code)) fail('未知错误码', u, String(msg.code));
      if (typeof msg.message !== 'string' || msg.message.trim() === '') fail('错误没有文案', u, JSON.stringify(msg));
      // 我们带着有效票据与座位发合法动作，就不该听到"没有座位"
      // 两个例外：① 还在等坐回原位的那个来回（新连接上确实没座位，是设计如此）；
      // ② 还有没答复的故意非法帧在飞——这条错误很可能是替它挨的，不能算在我们头上。
      if (this.pendingInvalid > 0) this.pendingInvalid -= 1;
      else if (msg.code === 'NOSEAT' && this.pendingIntent === 'valid' && this.seatId && !this.awaitingResume) {
        fail('有座位却被判无座位', u, `seat=${this.seatId} code=${this.code}`);
      }
    }
    if (msg.type === 'notice') {
      stats.notices[msg.code] = (stats.notices[msg.code] ?? 0) + 1;
      if (!NOTICE_CODES.includes(msg.code)) fail('未知通知码', u, String(msg.code));
    }
    if (msg.type === 'seatGranted') {
      if (typeof msg.ticket !== 'string' || msg.ticket.length < 16) fail('票据太短', u, String(msg.ticket));
      if (!['host', 'player', 'spectator'].includes(msg.role)) fail('席位角色非法', u, String(msg.role));
    }
    if (msg.type === 'snapshot' && msg.room) {
      const room = msg.room;
      const seats = Array.isArray(msg.seats) ? msg.seats : [];
      // revision 在快照顶层，只许前进（换房/重连入座时按 seatGranted 重置）
      if (typeof msg.revision !== 'number') fail('快照没有 revision', u, JSON.stringify(msg).slice(0, 200));
      else {
        if (this.revision >= 0 && msg.revision < this.revision) {
          fail('revision 倒退', u, `${this.revision} → ${msg.revision}（房 ${room.code}）`);
        }
        this.revision = msg.revision;
      }
      if (room.occupied > room.seatSlots) fail('占座数超过槽位', u, `occupied=${room.occupied} slots=${room.seatSlots}`);
      const ids = seats.map((x) => x.seatId);
      if (new Set(ids).size !== ids.length) fail('座位 id 重复', u, ids.join(','));
      const hosts = seats.filter((x) => x.role === 'host');
      if (hosts.length > 1) fail('同时有多个房主', u, `${room.code} 房主 ${hosts.length} 个`);
      if (room.hostSeatId && !ids.includes(room.hostSeatId)) fail('hostSeatId 指向不存在的座位', u, `${room.hostSeatId} ∉ ${ids.join(',')}`);
      // 相位只许往前走
      const order = { lobby: 0, playing: 1, ended: 2 };
      if (this.phase && order[room.phase] < order[this.phase]) {
        fail('相位倒退', u, `${this.phase} → ${room.phase}`);
      }
      this.phase = room.phase;
      // 按视角裁剪：别人的秘密不能出现在我的快照里
      if (msg.game && typeof msg.game === 'object' && Array.isArray(msg.game.others)) {
        for (const one of msg.game.others) {
          if (one && (one.secret !== undefined || one.hidden !== undefined)) {
            fail('快照泄露他人秘密', u, JSON.stringify(one).slice(0, 160));
          }
        }
      }
    }
  }
}

// ---------------- 动作目录 ----------------

const knownCodes = new Set();

const ACTIONS = [
  { w: 6, label: 'ready', can: (u) => u.seatId && u.role !== 'spectator', run: (u) => u.raw({ type: 'ready', ready: rnd() < 0.5 }, 'ready') },
  { w: 5, label: 'chat', can: () => true, run: (u) => u.raw({ type: 'chat', text: `猴叫 ${int(1, 9999)}` }, 'chat') },
  { w: 4, label: 'guess', can: (u) => u.seatId && u.phase === 'playing', run: (u) => u.raw({ type: 'gameAction', name: 'guess', payload: { value: int(0, 20) } }, 'guess') },
  { w: 2, label: 'pass', can: (u) => u.seatId && u.phase === 'playing', run: (u) => u.raw({ type: 'gameAction', name: 'pass' }, 'pass') },
  { w: 1, label: 'reveal', can: (u) => u.seatId && u.phase === 'playing', run: (u) => u.raw({ type: 'gameAction', name: 'reveal' }, 'reveal') },
  { w: 3, label: 'ping', can: () => true, run: (u) => u.raw({ type: 'ping', nonce: `n${int(1, 999)}` }, 'ping') },
  { w: 2, label: 'resync', can: () => true, run: (u) => u.raw({ type: 'resync', since: int(-5, 500) }, 'resync') },
  {
    w: 4,
    label: 'create',
    can: (u) => !u.seatId,
    run: (u) => {
      const r = u.raw(
        {
          type: 'roomCreate',
          gameId: pick(['fixture-turn', 'fixture-turn', 'fixture-simultaneous']),
          roomName: `猴房${int(1, 99)}`,
          seatSlots: int(1, 4),
          allowSpectate: rnd() < 0.7,
          config: {},
        },
        'roomCreate',
      );
      if (r) u.wantCode = true;
      return r;
    },
  },
  {
    w: 4,
    label: 'join',
    can: (u) => !u.seatId && knownCodes.size > 0,
    run: (u) => u.raw({ type: 'roomJoin', code: pick([...knownCodes]), as: rnd() < 0.2 ? 'spectator' : 'player' }, 'roomJoin'),
  },
  { w: 2, label: 'addAi', can: (u) => u.role === 'host', run: (u) => u.raw({ type: 'hostSeat', op: 'addAi' }, 'hostSeat.addAi') },
  { w: 3, label: 'start', can: (u) => u.role === 'host', run: (u) => u.raw({ type: 'hostStart' }, 'hostStart') },
  {
    w: 1,
    label: 'leave',
    can: (u) => u.seatId,
    run: (u) => {
      const ok = u.raw({ type: 'seatLeave' }, 'seatLeave');
      // 与 app.ts 的 leaveToLobby 一致：离席当场自己就知道没座位了。
      // 不这么做的台子会在离席后继续拿旧 seatId 发合法帧，然后把服务端正确的 NOSEAT 报成违规
      // （离席之后收不到那个房的快照，所以"按快照表清座位"这条规则救不了这种情况）。
      if (ok) {
        u.seatId = null;
        u.role = null;
        u.code = null;
        u.ticket = null;
      }
      return ok;
    },
  },
  { w: 1, label: 'kick', can: (u) => u.role === 'host', run: (u) => u.raw({ type: 'hostKick', seatId: `s${int(1, 999)}` }, 'hostKick', 'invalid') },
  { w: 1, label: 'transfer', can: (u) => u.role === 'host', run: (u) => u.raw({ type: 'hostTransfer', seatId: `s${int(1, 999)}` }, 'hostTransfer', 'invalid') },
  { w: 1, label: 'close', can: (u) => u.role === 'host' && rnd() < 0.15, run: (u) => u.raw({ type: 'hostClose', reason: '猴按错了' }, 'hostClose') },
  // ---- 故意非法：这些不该让服务端崩，也不该让界面进入说不清的状态 ----
  { w: 2, label: 'x:garbage', can: () => true, run: (u) => u.raw('这不是 JSON{{{', 'garbage', 'invalid') },
  { w: 2, label: 'x:unknown', can: () => true, run: (u) => u.raw({ type: '掀桌', foo: 1 }, 'unknownType', 'invalid') },
  { w: 2, label: 'x:missingField', can: () => true, run: (u) => u.raw({ type: 'roomJoin' }, '缺字段 roomJoin', 'invalid') },
  { w: 1, label: 'x:longChat', can: () => true, run: (u) => u.raw({ type: 'chat', text: '啊'.repeat(400) }, '超长 chat', 'invalid') },
  { w: 2, label: 'x:badResume', can: (u) => knownCodes.size > 0, run: (u) => u.raw({ type: 'seatResume', code: pick([...knownCodes]), seatId: 'ghost', ticket: 'x'.repeat(40) }, 'seatResume(假票据)', 'invalid') },
  { w: 1, label: 'x:hostOnly', can: (u) => u.role === 'player', run: (u) => u.raw({ type: 'hostStart' }, '玩家发 hostStart', 'invalid') },
  { w: 1, label: 'x:actionName', can: (u) => u.seatId, run: (u) => u.raw({ type: 'gameAction', name: '不存在的动作' }, '未知动作', 'invalid') },
];

function totalWeight(list) {
  return list.reduce((a, b) => a + b.w, 0);
}

function step(users) {
  const u = pick(users);
  if (!u.ws || u.ws.readyState !== WebSocket.OPEN) {
    u.connect();
    return;
  }
  const usable = ACTIONS.filter((a) => a.can(u));
  if (usable.length === 0) return;
  let r = rnd() * totalWeight(usable);
  for (const a of usable) {
    r -= a.w;
    if (r <= 0) {
      a.run(u);
      return;
    }
  }
}

// 记住见过的房号，供 join / 假票据用
function watchCodes(users) {
  for (const u of users) {
    if (u.code) knownCodes.add(u.code);
  }
}

// 重连后按 app.ts 同样的规矩坐回原位：带着票据 resume
function reconnect(users) {
  for (const u of users) {
    if (u.ticket && u.seatId && u.code) {
      stats.resumes++;
      u.pendingResume = { code: u.code, seatId: u.seatId, ticket: u.ticket };
      u.awaitingResume = true;
      u.events.push('< ⟲ 房主端重启，重连并坐回原位');
      u.connect();
    } else {
      u.seatId = null;
      u.code = null;
      u.role = null;
      u.connect();
    }
  }
}

async function main() {
  if (!existsSync(join(ROOT, 'packages/hostd/dist/cli.js'))) {
    console.log('先 npm run build');
    process.exit(1);
  }
  startShell();
  if (!(await waitHealth(15_000))) {
    console.log('房主端起不来：\n' + shellLog.slice(-1500));
    process.exit(1);
  }
  const users = Array.from({ length: USERS }, (_, i) => new User(i));
  for (const u of users) u.connect();
  await new Promise((r) => setTimeout(r, 700));

  const restartAt = new Set();
  for (let i = 0; i < RESTARTS; i++) restartAt.add(int(1, STEPS));

  for (let stepNo = 1; stepNo <= STEPS; stepNo++) {
    step(users);
    watchCodes(users);
    // 让上一发的回信落地再做下一发：不隔开发就分不清哪条错误是谁招来的
    await new Promise((r) => setTimeout(r, 4));
    if (restartAt.has(stepNo)) {
      await restartShell();
      await new Promise((r) => setTimeout(r, 500));
      reconnect(users);
      await new Promise((r) => setTimeout(r, 700));
    }
    if (stepNo % 100 === 0) {
      const ok = await waitHealth(1500);
      if (!ok) fail('跑到一半服务端没了', null, shellLog.slice(-1200));
      console.log(`  …第 ${stepNo} 步：发 ${stats.sent} 帧、收 ${stats.frames} 帧、违规 ${violations.length}`);
    }
  }

  await new Promise((r) => setTimeout(r, 800));
  // 落盘的东西必须还能解析
  const dataDir = join(ROOT, 'data');
  for (const f of existsSync(dataDir) ? readdirSync(dataDir) : []) {
    if (!f.endsWith('.json')) continue;
    try {
      JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
    } catch (e) {
      fail('落盘文件坏了', null, `${f}: ${String(e)}`);
    }
  }
  if (/Uncaught|TypeError:|RangeError:|ReferenceError:/.test(shellLog)) {
    fail('房主端日志里有未捕获异常', null, shellLog.slice(-1500));
  }

  for (const t of pendingTimers) clearTimeout(t);
  plannedExit = true;
  shell?.kill('SIGTERM');
  for (const u of users) {
    try {
      u.ws?.close();
    } catch {
      /* 已经关了 */
    }
  }
  await new Promise((r) => setTimeout(r, 300));

  // 收尾把自己在盘上留的痕迹收掉（绿红两条路都要走到，所以放在打印结果之前）：
  // 残留的 room-*.json 会被下一次启动的壳整批"恢复"出来，污染用户真实用过的目录；
  // run-<port>.json 留着则让 diagnose 谎报"在跑的壳"。只删本次运行写过的。
  for (const f of existsSync(dataDir) ? readdirSync(dataDir) : []) {
    const p = join(dataDir, f);
    const 是我这次造的 = f === `run-${PORT}.json` || (/^room-.*\.json$/.test(f) && statSync(p).mtimeMs >= RUN_STARTED_AT);
    if (是我这次造的) {
      try {
        unlinkSync(p);
      } catch {
        /* 删不动就算了，别把跑测本身搞挂 */
      }
    }
  }

  console.log(
    `\nseed=${SEED} users=${USERS} steps=${STEPS} 发${stats.sent}/收${stats.frames} 重启${stats.restarts} 重连入座${stats.resumes}`,
  );
  console.log('错误码命中：' + JSON.stringify(stats.errors));
  console.log('通知码命中：' + JSON.stringify(stats.notices));
  if (violations.length === 0) {
    console.log('不变式全部成立 ✔');
    process.exit(0);
  }
  console.log(`\n发现 ${violations.length} 条违规（复现：node tools/checks/monkey.mjs --seed ${SEED} --users ${USERS} --steps ${STEPS} --restarts ${RESTARTS}）\n`);
  for (const v of violations.slice(0, 12)) {
    console.log(`× [${v.kind}] 用户 ${v.user}：${v.detail}`);
    console.log('  时序：' + v.events.join('  '));
    console.log('  动作轨迹：' + v.trace.map((t) => `${t.sent}(${t.state}${t.intent === 'invalid' ? '|故意' : ''})`).join(' → '));
    console.log('  帧轨迹：' + v.frames.join(' '));
  }
  if (violations.length > 12) console.log(`  …另有 ${violations.length - 12} 条同类`);
  process.exit(1);
}

void main();
