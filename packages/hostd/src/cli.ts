#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import type { Server } from 'node:http';
import { Engine, HostStore, WsTransport, LanAnnouncer, LanBrowser, loadGames, toDiscoveryRoom, type GameModule } from '@bp/server';
import type { DiscoveryRoom } from '@bp/protocol';
import { createWebServer } from './webroot.js';
import { findCloudflared, startTunnel } from './tunnel.js';

/**
 * 宿主壳。三种活：
 *   host   房主：本机界面 127.0.0.1:<port>；另开 0.0.0.0:<lan-port> 给朋友（--no-lan 可关）
 *   join   玩家：只开本机界面 127.0.0.1:<port>，页面连别人的房主
 *   stop   按 data/run-<本机端口>.json 精确收掉本机进程
 *   diagnose 把环境事实打出来（游戏清单、隧道、组播开关）
 *
 * host 的两个监听共享同一个 Engine：本机页面与局域网玩家看到的是同一张桌子。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const DATA_DIR = join(ROOT, 'data');
/**
 * 记录按**本机界面端口**分文件。一个进程只有一个界面口；局域网口只作为记录里的字段。
 * 两个端口写两份记录会让 stop 对同一个 pid 下手两次，也会让 diagnose 把一桌数成两桌。
 */
const runFileFor = (port: number): string => join(DATA_DIR, `run-${port}.json`);
const DEFAULT_UI_PORT = 3178;
const DEFAULT_LAN_PORT = 3000;

interface Options {
  mode: 'host' | 'join' | 'stop' | 'diagnose';
  /** 本机界面端口，永远只绑 127.0.0.1。 */
  port: number;
  /** host 模式下对局域网/隧道开放的端口。 */
  lanPort: number;
  game: string;
  roomName: string;
  seats: number;
  tunnel: boolean;
  lan: boolean;
  announce: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    mode: (argv[0] as Options['mode']) || 'host',
    port: 0,
    lanPort: DEFAULT_LAN_PORT,
    game: 'echo',
    roomName: '未命名房间',
    seats: 4,
    tunnel: false,
    lan: true,
    announce: true,
  };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    switch (token) {
      case '--port':
        options.port = Number(next);
        i += 1;
        break;
      case '--lan-port':
        options.lanPort = Number(next);
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
      case '--no-announce':
        options.announce = false;
        break;
      default:
        break;
    }
  }
  // stop 不带 --port 表示"收掉所有在跑的壳"，所以不能给它塞默认端口
  if (!options.port && options.mode !== 'stop') options.port = DEFAULT_UI_PORT;
  if (options.mode === 'join') {
    options.lan = false;
    options.tunnel = false;
  }
  if (options.mode === 'host' && options.lan && options.port === options.lanPort) {
    console.error(`本机界面端口和局域网端口不能相同（都是 ${options.port}）。用 --port <本机口> --lan-port <局域网口>，默认是 3178 / 3000。`);
    process.exit(1);
  }
  if (options.tunnel && !options.lan) {
    console.error('--tunnel 需要一个对外的局域网监听端口；去掉 --no-lan 再试。');
    process.exit(1);
  }
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
  /** 本机界面端口。 */
  port: number;
  /** 局域网/隧道端口；join 模式为 null。 */
  lanPort: number | null;
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

/** 监听失败时把已开的口收回去，别让启动失败留下半个壳。 */
function listenOn(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function closeServer(server: Server): Promise<void> {
  // keep-alive 的连接会让 close 回调永远不来
  (server as { closeAllConnections?: () => void }).closeAllConnections?.();
  await Promise.race([
    new Promise<void>((r) => server.close(() => r())),
    new Promise<void>((r) => setTimeout(r, 1_000)),
  ]);
}

/**
 * 一个壳，两种角色。
 * host 与 join 的区别只剩：host 额外开一个对局域网的监听并广播；join 只听组播。
 * 两种角色都有完整内核，所以本机界面上"自己开房"永远可用。
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

  const browser = role === 'join' ? new LanBrowser() : null;
  browser?.start();

  const lanHosts = lanAddresses();
  const lanIp = lanHosts[0] ?? '127.0.0.1';
  const useLan = role === 'host' && options.lan;
  let tunnelUrl: string | null = null;

  /**
   * 页面用它来生成邀请链接。优先隧道（朋友在公网上点得开），其次局域网 IP。
   * 这里返回的是"朋友该用哪个地址"，不是本机页面自己的地址——本机页面永远是 127.0.0.1。
   */
  const selfInfo = () => ({
    uiOrigin: `http://127.0.0.1:${options.port}`,
    publicOrigin: tunnelUrl ?? (useLan ? `http://${lanIp}:${options.lanPort}` : null),
    lanOrigins: useLan ? lanHosts.map((ip) => `http://${ip}:${options.lanPort}`) : [],
  });

  const privateTransport = new WsTransport(engine, {});
  const privateServer = createWebServer({ root: ROOT, modules, getRooms: () => browser?.list() ?? [], selfInfo });
  privateTransport.attach(privateServer);

  const publicTransport = useLan ? new WsTransport(engine, {}) : null;
  const publicServer = useLan ? createWebServer({ root: ROOT, modules, getRooms: () => [], selfInfo }) : null;
  if (publicTransport && publicServer) publicTransport.attach(publicServer);

  const announcer = useLan && options.announce
    ? new LanAnnouncer(() => beaconRooms(engine, `ws://${lanIp}:${options.lanPort}/ws`))
    : null;

  const record: RunRecord = {
    mode: role,
    port: options.port,
    lanPort: useLan ? options.lanPort : null,
    httpPid: process.pid,
    tunnelPid: null,
    startedAt: Date.now(),
  };
  // 记录必须**在端口开始应答之前**写好：/health 一响应，`diagnose` 与 `stop` 就该看得见这个壳。
  writeRun(record);

  let listeningPort = options.port;
  try {
    await listenOn(privateServer, options.port, '127.0.0.1');
    if (publicServer) {
      listeningPort = options.lanPort;
      await listenOn(publicServer, options.lanPort, '0.0.0.0');
    }
  } catch (error) {
    removeRun(options.port);
    privateServer.close();
    publicServer?.close();
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      console.error(`\n端口 ${listeningPort} 已被占用，壳没有启动。`);
      console.error(`如果本机已经有一个壳在跑，直接用浏览器打开 http://127.0.0.1:${options.port}/ ；要重开就先把占用 ${listeningPort} 的那个壳关掉，或换一个端口。`);
    } else {
      console.error(`\n壳没能启动：${String(error)}`);
    }
    process.exit(1);
  }
  announcer?.start();

  const tunnel = options.tunnel ? await startTunnel(options.lanPort, (line) => console.log(`  tunnel| ${line}`)) : null;
  tunnelUrl = tunnel?.url ?? null;
  if (tunnel) writeRun({ ...record, tunnelPid: tunnel.pid });

  const tick = setInterval(() => {
    privateTransport.tick();
    publicTransport?.tick();
  }, 250);
  // 落盘跟着心跳走：syncStore 会跳过内容没变的房，所以勤调不写爆磁盘。
  // 差的就是"刚建房就被硬杀（点控制台 X 就是 TerminateProcess）"那一段——那时朋友已经拿到邀请链接了。
  const sync = setInterval(() => engine.syncStore(store), 250);

  const lines = role === 'host'
    ? [
      `房主端已就绪。本机界面：http://127.0.0.1:${options.port}`,
      `局域网入口：http://${lanIp}:${options.lanPort}（把页面上的邀请链接发给朋友即可）`,
      `组播广播：${announcer ? '已开启' : '已关闭'}（--no-announce / --no-lan 可关）`,
      `隧道：${tunnel?.url ?? (options.tunnel ? '未就绪（看上面的 tunnel 日志）' : '未启用（加 --tunnel 且本机装了 cloudflared 才有）')}`,
    ]
    : [
      `玩家进房已就绪：http://127.0.0.1:${options.port}`,
      '局域网房间监听：组播 239.255.77.178:47878（首次绑定 Windows 会弹窗，请你亲手点"允许"）',
      '这个入口只监听 127.0.0.1：自己开房能玩，别人连不进来。要当房主请用「房主建房.bat」。',
    ];
  lines.push(
    `装了这些游戏：${modules.map((m) => `${m.name}(${m.id} ${m.version})`).join('、')}`,
    restored.restored.length > 0 ? `恢复了上次的房：${restored.restored.join('、')}` : '没有需要恢复的对局',
    '',
    '打开上面的本机界面即可建房或进房。玩家只要一个网址或邀请链接，不需要装 Node。',
    'Ctrl+C 结束对局并落盘。',
  );
  banner(lines);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n收到 ${signal}，正在收尾…`);
    clearInterval(tick);
    clearInterval(sync);
    engine.shutdown();
    engine.syncStore(store);
    announcer?.stop();
    browser?.stop();
    await privateTransport.close();
    await publicTransport?.close();
    await Promise.all([
      closeServer(privateServer),
      ...(publicServer ? [closeServer(publicServer)] : []),
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

/** 不带 --port 就收掉本机所有在跑的壳（每个界面端口一份记录文件）。 */
function runStop(port: number | null): void {
  if (!existsSync(DATA_DIR)) {
    console.log(port === null ? '没有在跑的本地壳（data/run-*.json 为空）。' : `端口 ${port} 没有在跑的本地壳。`);
    return;
  }
  const files = readdirSync(DATA_DIR)
    .filter((name) => /^run-\d+\.json$/.test(name))
    .map((name) => join(DATA_DIR, name));
  let matched = 0;
  for (const file of files) {
    let record: RunRecord;
    try {
      record = JSON.parse(readFileSync(file, 'utf8')) as RunRecord;
    } catch {
      unlinkSync(file);
      continue;
    }
    const uiPort = typeof record.port === 'number' ? record.port : Number(/run-(\d+)\.json$/.exec(file)?.[1] ?? 0);
    const lanPort = typeof record.lanPort === 'number' ? record.lanPort : null;
    // 按任一端口都能找到同一个壳：用户记得的可能是局域网口 3000，也可能是界面口 3178
    if (port !== null && port !== uiPort && port !== lanPort) continue;
    matched += 1;
    const pids = [record.httpPid, record.tunnelPid].filter((p): p is number => typeof p === 'number' && p !== process.pid);
    for (const pid of pids) {
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
        else process.kill(pid, 'SIGTERM');
        console.log(`本机界面 ${uiPort}${lanPort ? ` / 局域网 ${lanPort}` : ''}：已请求结束进程 ${pid}`);
      } catch (error) {
        console.log(`本机界面 ${uiPort}：结束 ${pid} 失败：${String(error)}`);
      }
    }
    unlinkSync(file);
  }
  if (matched === 0) {
    console.log(port === null ? '没有在跑的本地壳（data/run-*.json 为空）。' : `端口 ${port} 没有在跑的本地壳。`);
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
  if (runs.length === 0) {
    console.log('在跑的壳：（无记录）');
  } else {
    for (const name of runs) {
      try {
        const record = JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8')) as RunRecord;
        console.log(`在跑的壳：${record.mode} · 本机界面 ${record.port} · 局域网 ${record.lanPort ?? '—'} · pid ${record.httpPid}`);
      } catch {
        console.log(`在跑的壳：${name}（记录读不出来）`);
      }
    }
  }
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
    console.log('用法：hostd host|join|diagnose|stop [--port N] [--lan-port N] [--game id] [--name 房名] [--seats N] [--tunnel] [--no-lan] [--no-announce]');
    console.log('  --port      本机界面端口（只绑 127.0.0.1），默认 3178');
    console.log('  --lan-port  房主模式对局域网开放的端口，默认 3000');
    process.exit(1);
}
