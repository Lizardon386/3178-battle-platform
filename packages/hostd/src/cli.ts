#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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
const RUN_FILE = join(ROOT, 'data', 'run.json');
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
  if (!options.port) options.port = options.mode === 'join' ? DEFAULT_SHELL_PORT : DEFAULT_HOST_PORT;
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
  mkdirSync(dirname(RUN_FILE), { recursive: true });
  writeFileSync(RUN_FILE, JSON.stringify(record, null, 2), 'utf8');
}

function removeRun(): void {
  if (existsSync(RUN_FILE)) unlinkSync(RUN_FILE);
}

async function runHost(options: Options): Promise<void> {
  const modules = await loadAllGames();
  if (modules.length === 0) {
    console.error(`没在 ${join(ROOT, 'games')} 找到任何已构建的游戏模块，先跑 npm run build`);
    process.exit(1);
  }
  const engine = new Engine({ modules });
  const store = new HostStore(join(ROOT, 'data'));
  store.purgeOrphans();
  const restored = engine.restoreFrom(store.readAll().entries);
  const transport = new WsTransport(engine, {});
  const server = createWebServer({ root: ROOT, modules, onBadPath: () => {} });
  transport.attach(server);

  const lanHost = lanAddresses()[0] ?? '127.0.0.1';
  const lanUrl = `ws://${lanHost}:${options.port}/ws`;
  const announcer = options.lan
    ? new LanAnnouncer(() => beaconRooms(engine, lanUrl))
    : null;
  announcer?.start();

  await new Promise<void>((r) => server.listen(options.port, '0.0.0.0', () => r()));
  const tunnel = options.tunnel ? await startTunnel(options.port, (line) => console.log(`  tunnel| ${line}`)) : null;

  const tick = setInterval(() => transport.tick(), 250);
  const sync = setInterval(() => engine.syncStore(store), 2_000);
  writeRun({ mode: 'host', port: options.port, httpPid: process.pid, tunnelPid: tunnel?.pid ?? null, startedAt: Date.now() });

  const local = `http://localhost:${options.port}`;
  const lines = [
    `房主端已就绪：本机 ${local}`,
    `局域网地址：${lanUrl}（同 WiFi 的装了本地壳的玩家能在列表里看到你）`,
    `隧道：${tunnel?.url ?? '未启用（加 --tunnel 且本机装了 cloudflared 才有）'}`,
    `装了这些游戏：${modules.map((m) => `${m.name}(${m.id} ${m.version})`).join('、')}`,
    restored.restored.length > 0 ? `恢复了上次的房：${restored.restored.join('、')}` : '没有需要恢复的对局',
    '',
    '打开上面的本机地址即可建房。玩家只要一网址或邀请链接，不需要装 Node。',
    'Ctrl+C 结束对局并落盘。',
  ];
  if (tunnel && !tunnel.url) lines.push(`隧道说明：${tunnel.note}`);
  banner(lines);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n收到 ${signal}，正在收尾…`);
    clearInterval(tick);
    clearInterval(sync);
    engine.shutdown();
    engine.syncStore(store);
    announcer?.stop();
    await transport.close();
    // keep-alive 的连接会让 close 回调永远不来
    (server as { closeAllConnections?: () => void }).closeAllConnections?.();
    await Promise.race([
      new Promise<void>((r) => server.close(() => r())),
      new Promise<void>((r) => setTimeout(r, 1_000)),
    ]);
    removeRun();
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

async function runJoin(options: Options): Promise<void> {
  const modules = await loadAllGames();
  const browser = new LanBrowser();
  browser.start();
  const server = createWebServer({ root: ROOT, modules, getRooms: () => browser.list() });
  await new Promise<void>((r) => server.listen(options.port, '127.0.0.1', () => r()));
  writeRun({ mode: 'join', port: options.port, httpPid: process.pid, tunnelPid: null, startedAt: Date.now() });
  banner([
    `本地壳已就绪：http://127.0.0.1:${options.port}`,
    `局域网房间监听：组播 239.255.77.178:${47878}（首次绑定 Windows 会弹窗，请你亲手点"允许"）`,
    '浏览器打开上面这个地址，就能看局域网房间列表，也能填地址进别人的房。',
    '注意：这个页面本身不承载对局，权威永远在房主那台机器。',
  ]);
  const close = (): void => {
    browser.stop();
    server.close();
    removeRun();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}

function runStop(): void {
  if (!existsSync(RUN_FILE)) {
    console.log('没有 data/run.json，本机壳大概没在跑。');
    return;
  }
  const record = JSON.parse(readFileSync(RUN_FILE, 'utf8')) as RunRecord;
  const pids = [record.httpPid, record.tunnelPid].filter((p): p is number => typeof p === 'number' && p !== process.pid);
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
      else process.kill(pid, 'SIGTERM');
      console.log(`已请求结束进程 ${pid}`);
    } catch (error) {
      console.log(`结束 ${pid} 失败：${String(error)}`);
    }
  }
  removeRun();
}

async function runDiagnose(): Promise<void> {
  const modules = await loadAllGames();
  console.log(`仓库根：${ROOT}`);
  console.log(`node：${process.version}（${process.execPath}）`);
  console.log(`已构建的游戏模块：${modules.length === 0 ? '（无，先 npm run build）' : modules.map((m) => `${m.id}@${m.version}`).join('、')}`);
  console.log(`cloudflared：${findCloudflared() ?? '未找到（跨网需要它）'}`);
  console.log(`本机 IPv4：${lanAddresses().join('、') || '（没找到非回环地址）'}`);
  console.log(`数据目录：${join(ROOT, 'data')}${existsSync(join(ROOT, 'data')) ? '（存在）' : '（还没建）'}`);
  console.log('注意：房主侧落盘只发生在 host 模式；join 模式不写 data/。');
}

const options = parseArgs(process.argv.slice(2));
switch (options.mode) {
  case 'host':
    await runHost(options);
    break;
  case 'join':
    await runJoin(options);
    break;
  case 'stop':
    runStop();
    break;
  case 'diagnose':
    await runDiagnose();
    break;
  default:
    console.log('用法：hostd host|join|diagnose|stop [--port N] [--game id] [--name 房名] [--seats N] [--tunnel] [--no-lan]');
    process.exit(1);
}
