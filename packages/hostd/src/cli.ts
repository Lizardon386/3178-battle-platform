#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { Engine, HostStore, WsTransport, LanAnnouncer, LanBrowser, loadGames, toDiscoveryRoom, type GameModule } from '@bp/server';
import type { DiscoveryRoom } from '@bp/protocol';
import { createWebServer } from './webroot.js';
import { findCloudflared, startTunnel } from './tunnel.js';

/**
 * 宿主壳。三种活：
 *   host   房主：起引擎 + ws + 静态页 + 组播广播 +（可选）隧道
 *   join   玩家：只起本地壳（静态页 + 组播监听 + /discovery/rooms），页面连别人的房主
 *   stop   按 data/run.json 精确收掉本机进程
 *   diagnose 把环境事实打出来（游戏清单、隧道、组播开关）
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const DATA_DIR = join(ROOT, 'data');
/**
 * 记录按端口分文件。以前只有一个 data/run.json，
 * 一台机器同时跑「房主端 3000」和「本地壳 3178」时后者会覆盖前者，
 * `stop` 就只能停掉最后启动的那个，另一个变成没人知道的残留进程。
 */
const runFileFor = (port: number): string => join(DATA_DIR, `run-${port}.json`);
const DEFAULT_HOST_PORT = 3000;
const DEFAULT_SHELL_PORT = 3178;

interface Options {
  mode: 'host' | 'join' | 'stop' | 'diagnose';
  port: number;
  game: string;
  roomName: string;
  seats: number;
  tunnel: boolean;
  lan: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    mode: (argv[0] as Options['mode']) || 'host',
    port: 0,
    game: 'echo',
    roomName: '未命名房间',
    seats: 4,
    tunnel: false,
    lan: true,
  };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    switch (token) {
      case '--port':
        options.port = Number(next);
        i += 1;
        break;
      case '--game':
        options.game = next ?? options.game;
        i += 1;
        break;
      case '--name':
        options.roomName = next ?? options.roomName;
        i += 1;
        break;
      case '--seats':
        options.seats = Number(next);
        i += 1;
        break;
      case '--tunnel':
        options.tunnel = true;
        break;
      case '--no-lan':
        options.lan = false;
        break;
      default:
        break;
    }
  }
  // stop 不带 --port 表示"收掉所有在跑的壳"，所以不能给它塞默认端口
  if (!options.port && options.mode !== 'stop') options.port = options.mode === 'join' ? DEFAULT_SHELL_PORT : DEFAULT_HOST_PORT;
  return options;
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

function banner(lines: string[]): void {
  const width = Math.max(...lines.map((l) => l.length), 32);
  console.log(`\n${'='.repeat(width + 4)}`);
  for (const line of lines) console.log(`  ${line}`);
  console.log(`${'='.repeat(width + 4)}\n`);
}

async function loadAllGames(): Promise<GameModule[]> {
  return loadGames(join(ROOT, 'games'));
}

interface RunRecord {
  mode: Options['mode'];
  port: number;
  httpPid: number;
  tunnelPid: number | null;
  startedAt: number;
}

function writeRun(record: RunRecord): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(runFileFor(record.port), JSON.stringify(record, null, 2), 'utf8');
}

function removeRun(port: number): void {
  const file = runFileFor(port);
  if (existsSync(file)) unlinkSync(file);
}

/**
 * 一个壳，两种角色。以前 `join` 模式只挂静态页没挂 WS 服务，
 * 结果玩家在本地壳上点"建房"会得到一句莫名其妙的连接失败——
 * 按"每人本机一份客户端"的设定，谁都能开房，所以两种角色都要有完整内核。
 * 差别只剩三处：绑定地址、是否听组播、是否起隧道。
 */
async function startShell(options: Options, role: 'host' | 'join'): Promise<void> {
  const modules = await loadAllGames();
  if (modules.length === 0) {
    console.error(`没在 ${join(ROOT, 'games')} 找到任何已构建的游戏模块，先跑 npm run build`);
    process.exit(1);
  }
  const engine = new Engine({ modules });
  const store = new HostStore(join(ROOT, 'data'));
  // 票据发出前先落盘：syncStore 会跳过内容没变的房，所以这一刀只在"有人入座/重连坐回"时真的写盘
  engine.onTicketIssued = () => engine.syncStore(store);
  store.purgeOrphans();
  const restored = engine.restoreFrom(store.readAll().entries);
  const transport = new WsTransport(engine, {});
  const browser = role === 'join' ? new LanBrowser() : null;
  browser?.start();
  const server = createWebServer({ root: ROOT, modules, getRooms: () => browser?.list() ?? [] });
  transport.attach(server);

  const lanHost = lanAddresses()[0] ?? '127.0.0.1';
  const lanUrl = `ws://${lanHost}:${options.port}/ws`;
  const announcer = options.lan ? new LanAnnouncer(() => beaconRooms(engine, lanUrl)) : null;
  announcer?.start();

  const host = role === 'host' ? '0.0.0.0' : '127.0.0.1';
  // 记录必须**在端口开始应答之前**写好：/health 一响应，`diagnose` 与 `stop` 就该看得见这个壳。
  // 反过来（先听后写）会留一个窗口——health 已经 200、盘上还没有记录，`stop` 找不到它，
  // 于是出现"没记录但活着"的遗留壳（本会话真遇到一个，只能靠 PID 收拾）；并行测试也撞过这个窗口。
  const record: RunRecord = { mode: role, port: options.port, httpPid: process.pid, tunnelPid: null, startedAt: Date.now() };
  writeRun(record);
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(options.port, host, () => resolveListen());
    });
  } catch (error) {
    removeRun(options.port); // 端口没起来就别留记录，否则 diagnose 会谎报"在跑的壳"
    throw error;
  }
  const tunnel = options.tunnel ? await startTunnel(options.port, (line) => console.log(`  tunnel| ${line}`)) : null;
  if (tunnel) writeRun({ ...record, tunnelPid: tunnel.pid });

  const tick = setInterval(() => transport.tick(), 250);
  // 落盘跟着心跳走：syncStore 会跳过内容没变的房，所以勤调不写爆磁盘。
  // 差的就是"刚建房就被硬杀（点控制台 X 就是 TerminateProcess）"那一段——那时朋友已经拿到邀请链接了。
  const sync = setInterval(() => engine.syncStore(store), 250);

  const lines = role === 'host'
    ? [
      `房主端已就绪：本机 http://localhost:${options.port}`,
      `局域网地址：${lanUrl}（同 WiFi 装了本地壳的玩家能在列表里看到你）`,
      `隧道：${tunnel?.url ?? '未启用（加 --tunnel 且本机装了 cloudflared 才有）'}`,
    ]
    : [
      `本地壳已就绪：http://127.0.0.1:${options.port}`,
      '局域网房间监听：组播 239.255.77.178:47878（首次绑定 Windows 会弹窗，请你亲手点"允许"）',
      '这个壳只监听 127.0.0.1：自己开房玩可以，别人连不进来。要当房主请用「房主建房.bat」。',
    ];
  lines.push(
    `装了这些游戏：${modules.map((m) => `${m.name}(${m.id} ${m.version})`).join('、')}`,
    restored.restored.length > 0 ? `恢复了上次的房：${restored.restored.join('、')}` : '没有需要恢复的对局',
    '',
    '打开上面的地址即可建房或进房。玩家只要一网址或邀请链接，不需要装 Node。',
    'Ctrl+C 结束对局并落盘。',
  );
  if (tunnel && !tunnel.url) lines.push(`隧道说明：${tunnel.note}`);
  banner(lines);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n收到 ${signal}，正在收尾…`);
    clearInterval(tick);
    clearInterval(sync);
    engine.shutdown();
    engine.syncStore(store);
    announcer?.stop();
    browser?.stop();
    await transport.close();
    // keep-alive 的连接会让 close 回调永远不来
    (server as { closeAllConnections?: () => void }).closeAllConnections?.();
    await Promise.race([
      new Promise<void>((r) => server.close(() => r())),
      new Promise<void>((r) => setTimeout(r, 1_000)),
    ]);
    removeRun(options.port);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

function beaconRooms(engine: Engine, lanUrl: string): DiscoveryRoom[] {
  return engine.registry.list(false).map((room) => {
    const view = room.roomView();
    return toDiscoveryRoom(
      {
        code: view.code,
        name: view.name,
        gameId: view.gameId,
        gameName: view.gameName,
        phase: view.phase,
        occupied: view.occupied,
        seatSlots: view.seatSlots,
        hostName: view.hostName ?? '房主',
        hidden: room.hidden,
      },
      lanUrl,
      8,
    );
  });
}

/** 不带 --port 就收掉本机所有在跑的壳（每个端口一份记录文件）。 */
function runStop(port: number | null): void {
  const files = existsSync(DATA_DIR)
    ? readdirSync(DATA_DIR)
      .filter((name) => /^run-\d+\.json$/.test(name))
      .filter((name) => (port === null ? true : name === `run-${port}.json`))
      .map((name) => join(DATA_DIR, name))
    : [];
  if (files.length === 0) {
    console.log(port === null ? '没有在跑的本地壳（data/run-*.json 为空）。' : `端口 ${port} 没有在跑的本地壳。`);
    return;
  }
  for (const file of files) {
    let record: RunRecord;
    try {
      record = JSON.parse(readFileSync(file, 'utf8')) as RunRecord;
    } catch {
      unlinkSync(file);
      continue;
    }
    const pids = [record.httpPid, record.tunnelPid].filter((p): p is number => typeof p === 'number' && p !== process.pid);
    for (const pid of pids) {
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
        else process.kill(pid, 'SIGTERM');
        console.log(`端口 ${record.port}：已请求结束进程 ${pid}`);
      } catch (error) {
        console.log(`端口 ${record.port}：结束 ${pid} 失败：${String(error)}`);
      }
    }
    unlinkSync(file);
  }
}

async function runDiagnose(): Promise<void> {
  const modules = await loadAllGames();
  console.log(`仓库根：${ROOT}`);
  console.log(`node：${process.version}（${process.execPath}）`);
  console.log(`已构建的游戏模块：${modules.length === 0 ? '（无，先 npm run build）' : modules.map((m) => `${m.id}@${m.version}`).join('、')}`);
  console.log(`cloudflared：${findCloudflared() ?? '未找到（跨网需要它）'}`);
  console.log(`本机 IPv4：${lanAddresses().join('、') || '（没找到非回环地址）'}`);
  console.log(`数据目录：${DATA_DIR}${existsSync(DATA_DIR) ? '（存在）' : '（还没建）'}`);
  const runs = existsSync(DATA_DIR) ? readdirSync(DATA_DIR).filter((n) => /^run-\d+\.json$/.test(n)) : [];
  console.log(`在跑的壳：${runs.length === 0 ? '（无记录）' : runs.join('、')}`);
  console.log('注意：两种壳都会往 data/ 写自己开过的房——房主侧才有权威，玩家进别人的房不写别人的盘。');
}

const options = parseArgs(process.argv.slice(2));
switch (options.mode) {
  case 'host':
    await startShell(options, 'host');
    break;
  case 'join':
    await startShell(options, 'join');
    break;
  case 'stop':
    runStop(options.port || null);
    break;
  case 'diagnose':
    await runDiagnose();
    break;
  default:
    console.log('用法：hostd host|join|diagnose|stop [--port N] [--game id] [--name 房名] [--seats N] [--tunnel] [--no-lan]');
    process.exit(1);
}
