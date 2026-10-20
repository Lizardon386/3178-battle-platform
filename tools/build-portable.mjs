#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHostBat, renderJoinBat, verifyBat } from './gen-bat.mjs';

/**
 * 绿色便携包：官方签名的 node.exe + 运行所需产物，拷到干净机器双击就能跑。
 * 不打包源码、测试、TypeScript、整个 node_modules，也不碰 data/。
 *
 * 用法：node tools/build-portable.mjs [--out <目录>] [--node <node.exe>] [--skip-build] [--force]
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = join(ROOT, 'dist-portable', '3178-battle-platform');
const MARKER = '.portable-build.json';

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, node: null, skipBuild: false, allowUnsigned: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--out') args.out = resolve(argv[++i]);
    else if (token === '--node') args.node = resolve(argv[++i]);
    else if (token === '--skip-build') args.skipBuild = true;
    else if (token === '--allow-unsigned-node') args.allowUnsigned = true;
    else if (token === '--force') args.force = true;
    else if (token === '--help') {
      console.log('用法：node tools/build-portable.mjs [--out <目录>] [--node <node.exe>] [--skip-build] [--force]');
      process.exit(0);
    }
  }
  return args;
}

function fail(message) {
  console.error(`[x] ${message}`);
  process.exit(1);
}

function step(message) {
  console.log(`\n== ${message}`);
}

function build() {
  step('编译 TypeScript');
  const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(tsc)) fail('找不到 node_modules/typescript，先跑 npm install');
  const result = spawnSync(process.execPath, [tsc, '-b'], { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) fail('tsc -b 失败，先修编译错误再打包');
}

function findNode(explicit) {
  if (explicit) {
    if (!existsSync(explicit)) fail(`--node 指定的文件不存在：${explicit}`);
    return explicit;
  }
  const candidates = [
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs', 'node.exe') : null,
    process.execPath,
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) fail('没找到 node.exe，用 --node 指定一个官方发行版的 node.exe');
  return found;
}

function nodeVersion(nodeExe) {
  const result = spawnSync(nodeExe, ['-v'], { encoding: 'utf8' });
  if (result.status !== 0) fail(`跑不起来：${nodeExe}\n${result.stderr}`);
  const version = result.stdout.trim();
  const major = Number(version.replace(/^v/, '').split('.')[0]);
  if (!Number.isFinite(major) || major < 24) fail(`便携包要求 Node 24+，这个 node 是 ${version}：${nodeExe}`);
  return version;
}

function checkSignature(nodeExe, allowUnsigned) {
  if (process.platform !== 'win32') return null;
  const quoted = nodeExe.replace(/'/g, "''");
  const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $s=Get-AuthenticodeSignature '${quoted}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  const text = (result.stdout ?? '').trim();
  const [status, subject] = text.split('|');
  if (result.status !== 0) fail(`签名检查失败：${(result.stderr ?? '').trim() || text}`);
  if (status !== 'Valid') {
    if (allowUnsigned) return null;
    fail(`node.exe 的 Authenticode 状态是 ${status || '(空)'}；这台机器开了 Smart App Control 时会拦。用官方 node 发行版，或确认后加 --allow-unsigned-node`);
  }
  return subject ?? null;
}

function prepareOut(out, force) {
  if (existsSync(out)) {
    const marker = join(out, MARKER);
    if (!existsSync(marker) && !force) {
      fail(`输出目录已存在且不是上一次的便携包构建产物：${out}\n确认可以覆盖后加 --force`);
    }
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync(out, { recursive: true });
}

function copy(rel) {
  const src = join(ROOT, rel);
  if (!existsSync(src)) fail(`缺文件：${rel}（先跑一次构建）`);
  cpSync(src, join(OUT, rel), { recursive: true, dereference: true });
}

function copyOne(srcRel, destRel) {
  const src = join(ROOT, srcRel);
  if (!existsSync(src)) return false;
  mkdirSync(dirname(join(OUT, destRel)), { recursive: true });
  cpSync(src, join(OUT, destRel));
  return true;
}

function copyRuntimeModules() {
  step('装配 node_modules 运行时子集');
  mkdirSync(join(OUT, 'node_modules'), { recursive: true });
  copy('node_modules/ws');
  mkdirSync(join(OUT, 'node_modules', '@bp'), { recursive: true });
  for (const name of readdirSync(join(ROOT, 'node_modules', '@bp'))) {
    const pkgDir = join(ROOT, 'node_modules', '@bp', name);
    if (!existsSync(join(pkgDir, 'package.json'))) continue;
    const dest = join(OUT, 'node_modules', '@bp', name);
    mkdirSync(dest, { recursive: true });
    cpSync(join(pkgDir, 'package.json'), join(dest, 'package.json'));
    if (existsSync(join(pkgDir, 'dist'))) cpSync(join(pkgDir, 'dist'), join(dest, 'dist'), { recursive: true });
  }

  copyOne('node_modules/@tabler/core/dist/css/tabler.min.css', 'node_modules/@tabler/core/dist/css/tabler.min.css');
  copyOne('node_modules/@tabler/icons-webfont/dist/tabler-icons.min.css', 'node_modules/@tabler/icons-webfont/dist/tabler-icons.min.css');
  for (const font of ['tabler-icons.ttf', 'tabler-icons.woff', 'tabler-icons.woff2']) {
    copyOne(`node_modules/@tabler/icons-webfont/dist/fonts/${font}`, `node_modules/@tabler/icons-webfont/dist/fonts/${font}`);
  }
}

function writeLicenses() {
  const licenses = [
    ['node_modules/ws/LICENSE', 'ws-LICENSE.txt'],
    ['node_modules/@tabler/core/LICENSE', 'tabler-core-LICENSE.txt'],
    ['node_modules/@tabler/icons-webfont/LICENSE', 'tabler-icons-webfont-LICENSE.txt'],
  ];
  for (const [src, name] of licenses) copyOne(src, join('licenses', name));
}

function writeUsage() {
  const text = [
    '3178 对战平台 · 绿色便携包',
    '',
    '双击入口：',
    '  房主建房.bat   本机开房（本机界面 http://127.0.0.1:3178 ，局域网端口 3000）',
    '  玩家本机壳.bat 只开本地大厅，用来进别人的房',
    '',
    '两个入口共用同一个本机界面端口，不要同时开。',
    '房主第一次启动时 Windows 可能弹出防火墙提示：请亲手点“允许”，脚本不会替你改防火墙。',
    '',
    '停止：在对局控制台窗口按 Ctrl+C，会先落盘再退出；窗口自己关闭。',
    '数据：data/ 目录由程序自动创建，房间与票据只落在房主这一侧。',
    '',
    '不需要安装 Node 或 npm。浏览器要求 Chrome / Edge 111 及以上。',
    '跨网需要房主本机安装 cloudflared，并在房主启动器上追加 --tunnel。',
    '',
  ].join('\r\n');
  writeFileSync(join(OUT, '使用说明.txt'), text, 'utf8');
}

function listTextFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTextFiles(absolute));
    else if (['.js', '.mjs', '.json', '.html', '.css', '.bat', '.txt', '.md'].includes(extname(entry.name).toLowerCase())) out.push(absolute);
  }
  return out;
}

function assertNoWorkspaceLeak() {
  step('检查包内没有工作区绝对路径');
  const leaks = [];
  for (const file of listTextFiles(OUT)) {
    const text = readFileSync(file, 'utf8');
    if (text.includes('D:\\agent_workspace') || text.includes('D:/agent_workspace') || text.includes('/d/agent_workspace')) {
      leaks.push(relative(OUT, file));
    }
  }
  if (leaks.length > 0) fail(`这些文件还带着本机工作区路径：\n${leaks.join('\n')}`);
  console.log('OK：没有工作区绝对路径');
}

function assertBarePackagesReal() {
  step('检查 @bp 依赖是实体目录（不是 workspace 符号链接）');
  for (const name of readdirSync(join(OUT, 'node_modules', '@bp'))) {
    const absolute = join(OUT, 'node_modules', '@bp', name);
    if (lstatSync(absolute).isSymbolicLink()) fail(`@bp/${name} 还是符号链接，离开本仓库就解析不到`);
  }
  console.log('OK：@bp/* 都是实体目录');
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(absolute) : statSync(absolute).size;
  }
  return total;
}

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => res(port));
    });
  });
}

async function smoke(nodeExe, nodeVersionText) {
  step('自检：剥掉 PATH 里的 node/npm 后，用包内 node 跑 diagnose 与 host');
  const cleanEnv = {
    ...process.env,
    PATH: process.platform === 'win32' ? 'C:\\Windows\\System32;C:\\Windows' : '/usr/bin:/bin',
  };
  const diag = spawnSync(nodeExe, ['packages/hostd/dist/cli.js', 'diagnose'], { cwd: OUT, env: cleanEnv, encoding: 'utf8' });
  if (diag.status !== 0) fail(`diagnose 失败（退出码 ${diag.status}）：\n${diag.stdout}\n${diag.stderr}`);
  for (const needle of ['echo@0.1.0', 'turncount@0.1.0', nodeVersionText]) {
    if (!diag.stdout.includes(needle)) fail(`diagnose 输出里没有 ${needle}：\n${diag.stdout}`);
  }
  console.log('OK：diagnose 能找到两个游戏与包内 node');

  const port = await freePort();
  const child = spawn(nodeExe, ['packages/hostd/dist/cli.js', 'host', '--port', String(port), '--no-lan'], {
    cwd: OUT,
    env: cleanEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => (log += b.toString()));
  child.stderr.on('data', (b) => (log += b.toString()));

  const deadline = Date.now() + 15_000;
  let health = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(400) });
      if (res.ok) {
        health = await res.json();
        break;
      }
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!health) {
    child.kill();
    fail(`便携包里的 host 没起来：\n${log}`);
  }
  const ids = (health.games ?? []).slice().sort();
  if (ids.join(',') !== 'echo,turncount') fail(`/health 的游戏清单不对：${JSON.stringify(ids)}\n${log}`);

  const stop = spawnSync(nodeExe, ['packages/hostd/dist/cli.js', 'stop', '--port', String(port)], { cwd: OUT, env: cleanEnv, encoding: 'utf8' });
  if (stop.status !== 0) fail(`stop 失败：\n${stop.stdout}\n${stop.stderr}`);
  await Promise.race([
    new Promise((r) => child.once('close', r)),
    new Promise((r) => setTimeout(r, 8_000)),
  ]);
  const runFile = join(OUT, 'data', `run-${port}.json`);
  if (existsSync(runFile)) fail('stop 之后 run 记录还在');
  console.log('OK：host 启动、/health、stop 收尾都正常（全程只用包内 node）');

  rmSync(join(OUT, 'data'), { recursive: true, force: true });
}

const args = parseArgs(process.argv.slice(2));
if (!args.skipBuild) build();
const nodeExe = findNode(args.node);
const nodeVersionText = nodeVersion(nodeExe);
const signer = checkSignature(nodeExe, args.allowUnsigned);
if (args.allowUnsigned && !signer) console.warn('[!] 未校验签名的 node.exe，SAC 机器可能拦它');

prepareOut(args.out, args.force);
const OUT = args.out;
mkdirSync(OUT, { recursive: true });

step(`装配便携包 → ${OUT}`);
copy('packages/protocol/dist');
copy('packages/protocol/package.json');
copy('packages/server/dist');
copy('packages/server/package.json');
copy('packages/client/dist');
copy('packages/client/public');
copy('packages/client/package.json');
copy('packages/hostd/dist');
copy('packages/hostd/package.json');
copy('games/echo/dist');
copy('games/echo/package.json');
copy('games/turncount/dist');
copy('games/turncount/package.json');
copyRuntimeModules();
cpSync(nodeExe, join(OUT, 'node.exe'));

step('生成启动器与许可');
const hostBat = renderHostBat({ portable: true });
const joinBat = renderJoinBat({ portable: true });
writeFileSync(join(OUT, '房主建房.bat'), hostBat, 'utf8');
writeFileSync(join(OUT, '玩家本机壳.bat'), joinBat, 'utf8');
verifyBat('房主建房.bat（便携版）', readFileSync(join(OUT, '房主建房.bat'), 'utf8'));
verifyBat('玩家本机壳.bat（便携版）', readFileSync(join(OUT, '玩家本机壳.bat'), 'utf8'));
writeLicenses();
writeUsage();

writeFileSync(
  join(OUT, MARKER),
  JSON.stringify({
    name: '3178-battle-platform',
    version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
    builtAt: new Date().toISOString(),
    node: nodeVersionText,
    nodeSigner: signer,
  }, null, 2),
  'utf8',
);

assertBarePackagesReal();
assertNoWorkspaceLeak();
await smoke(nodeExe, nodeVersionText);

step('完成');
const sizeMb = (dirSize(OUT) / 1024 / 1024).toFixed(1);
console.log(`便携包：${OUT}`);
console.log(`体积：约 ${sizeMb} MB（其中 node.exe 约 ${(statSync(join(OUT, 'node.exe')).size / 1024 / 1024).toFixed(1)} MB）`);
console.log('拷到干净机器后双击「房主建房.bat」即可。');
