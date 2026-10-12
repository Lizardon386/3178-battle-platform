import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

/**
 * 最小复现：房主 + 玩家同房 → 硬杀房主端 → 两边各自用真票据重连。
 * 问的是：玩家坐不坐得回去？（协议层猴测报了两例"真票据被拒"，都是玩家座位）
 *   node tools/repro-resume.mjs [端口] [重启前等多少毫秒]
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] ?? 3531);
const WAIT = Number(process.argv[3] ?? 1500);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DATA = join(ROOT, 'data');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function up() {
  for (let i = 0; i < 150; i++) {
    try {
      const r = await fetch(`${ORIGIN}/health`, { signal: AbortSignal.timeout(400) });
      if (r.ok) return true;
    } catch { /* 还没起来 */ }
    await sleep(100);
  }
  return false;
}

function client(nick) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const frames = [];
  ws.on('message', (b) => frames.push(JSON.parse(b.toString())));
  const api = {
    ws,
    frames,
    async hello() {
      await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
      ws.send(JSON.stringify({ type: 'hello', protocol: 1, nick, gameId: 'echo', version: '0.1.0' }));
      return api.until('welcome');
    },
    until(type, pred = () => true, ms = 4000) {
      const t0 = Date.now();
      return new Promise((r, j) => {
        const tick = () => {
          const f = frames.find((m) => m.type === type && pred(m));
          if (f) return r(f);
          const err = frames.find((m) => m.type === 'error');
          if (err && Date.now() - t0 > 600) return j(new Error(`${nick}: 先收到 error/${err.code} ${err.message}`));
          if (Date.now() - t0 > ms) return j(new Error(`${nick}: 没等到 ${type}`));
          setTimeout(tick, 30);
        };
        tick();
      });
    },
    send(m) { ws.send(JSON.stringify(m)); },
  };
  return api;
}

if (existsSync(DATA)) for (const f of readdirSync(DATA)) if (f.startsWith('room-')) rmSync(join(DATA, f));

let shell = spawn(process.execPath, [join(ROOT, 'packages/hostd/dist/cli.js'), 'host', '--port', String(PORT), '--no-lan'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
if (!(await up())) { console.log('起不来'); process.exit(1); }

const host = client('房主甲');
await host.hello();
host.send({ type: 'roomCreate', gameId: 'echo', roomName: '复现重连房', seatSlots: 3, config: {} });
const hg = await host.until('seatGranted');
const hostSeat = { code: hg.code, seatId: hg.seatId, ticket: hg.ticket };
console.log(`房主入座 ${hg.code} / ${hg.seatId}`);

const guest = client('玩家乙');
await guest.hello();
guest.send({ type: 'roomJoin', code: hg.code });
const gg = await guest.until('seatGranted');
const guestSeat = { code: gg.code, seatId: gg.seatId, ticket: gg.ticket };
console.log(`玩家入座 ${gg.code} / ${gg.seatId}（角色 ${gg.role}）`);

await sleep(WAIT);
const onDisk = existsSync(join(DATA, `room-${hg.code}.json`));
let diskSeats = [];
if (onDisk) {
  const d = JSON.parse(readFileSync(join(DATA, `room-${hg.code}.json`), 'utf8'));
  diskSeats = d.room.seats.map((s) => `${s.slot}:${s.role}:${s.seatId}${s.secretHash ? '' : ':无票据摘要'}`);
}
console.log(`重启前盘上：${onDisk ? `有 room-${hg.code}.json，座位 ${diskSeats.join(' ')}` : '没有这个房的文件'}`);

shell.kill('SIGTERM');
await sleep(900);
shell.kill('SIGKILL');
await sleep(300);
shell = spawn(process.execPath, [join(ROOT, 'packages/hostd/dist/cli.js'), 'host', '--port', String(PORT), '--no-lan'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
if (!(await up())) { console.log('重启后起不来'); process.exit(1); }
console.log(`重启后盘上：${existsSync(join(DATA, `room-${hg.code}.json`)) ? '文件还在' : '文件没了'}`);

// 玩家先重连（房主还没回来的时候能不能坐回原位），房主后重连。
// 顺序反了会自己造坑：房主重连完就关连接 → 平台按"房主掉线"删局 → 玩家只能拿到 NOROOM。
const resumed = [];
for (const [name, seat] of [['玩家', guestSeat], ['房主', hostSeat]]) {
  const c = client(`${name}重连`);
  await c.hello();
  c.send({ type: 'seatResume', code: seat.code, seatId: seat.seatId, ticket: seat.ticket });
  const outcome = await c.until('seatGranted').then((g) => `坐回去了（${g.role}，座位 ${g.seatId}）`).catch((e) => `失败：${e.message}`);
  console.log(`${name}用真票据重连 → ${outcome}`);
  resumed.push(c);
}

// 两边都在席之后再验一次"房主开局"，确认玩家的重连不是只占了个空壳座位
if (resumed.length === 2) {
  resumed[1].send({ type: 'hostStart' });
  const started = await resumed[1].until('snapshot', (m) => m.phase === 'playing').then(() => '开局成功').catch((e) => `开局失败：${e.message}`);
  console.log(`房主重连后直接开局 → ${started}`);
}
for (const c of resumed) c.ws.close();

shell.kill('SIGKILL');
await sleep(300);
