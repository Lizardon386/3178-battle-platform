import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

/**
 * 量一件事：从"建房成功"到"盘上出现这个房的文件"要多久。
 * 这段就是硬杀（点控制台窗口的 X 也是 TerminateProcess，不走收尾）会丢房的窗口。
 *   node tools/checks/repro-persist.mjs [端口]
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.argv[2] ?? 3521);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DATA = join(ROOT, 'data');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function up() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${ORIGIN}/health`, { signal: AbortSignal.timeout(400) });
      if (r.ok) return true;
    } catch { /* 还没起来 */ }
    await sleep(100);
  }
  return false;
}

if (existsSync(DATA)) for (const f of readdirSync(DATA)) if (f.startsWith('room-')) rmSync(join(DATA, f));

const child = spawn(process.execPath, [join(ROOT, 'packages/hostd/dist/cli.js'), 'host', '--port', String(PORT), '--no-lan'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (!(await up())) {
  console.log('房主端起不来');
  process.exit(1);
}

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
const frames = [];
ws.on('message', (b) => frames.push(JSON.parse(b.toString())));
await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
ws.send(JSON.stringify({ type: 'hello', protocol: 1, nick: '量落盘', gameId: 'fixture-turn' }));
while (!frames.find((m) => m.type === 'welcome')) await sleep(20);
ws.send(JSON.stringify({ type: 'roomCreate', gameId: 'fixture-turn', roomName: '量落盘房', seatSlots: 2, config: {} }));
while (!frames.find((m) => m.type === 'seatGranted')) await sleep(20);
const code = frames.find((m) => m.type === 'seatGranted').code;
const file = join(DATA, `room-${code}.json`);

const t0 = Date.now();
while (!existsSync(file) && Date.now() - t0 < 10_000) await sleep(20);
console.log(`房 ${code} 建房成功 → 盘上出现文件：${existsSync(file) ? `${Date.now() - t0} ms` : '10 秒内没出现（失败）'}`);

const seatsOf = () => {
  try {
    return (JSON.parse(readFileSync(file, 'utf8')).room?.seats ?? []).length;
  } catch {
    return -1;
  }
};
const before = seatsOf();
ws.send(JSON.stringify({ type: 'hostSeat', op: 'addAi' }));
const t1 = Date.now();
let changed = false;
while (Date.now() - t1 < 10_000) {
  await sleep(20);
  if (seatsOf() > before) { changed = true; break; }
}
console.log(`加一个电脑位（座位 ${before} → ${before + 1}）→ 盘上反映：${changed ? `${Date.now() - t1} ms` : '10 秒内没变（失败）'}`);

ws.close();
child.kill('SIGKILL');
await sleep(300);
