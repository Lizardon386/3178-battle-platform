#!/usr/bin/env node
/**
 * 原生 Supervisor smoke：启动 bp-supervisor.exe，经命名管道拉起 Node Session Service，
 * 访问管理页与 listGames，再停止并退出。需要先构建 C# 解决方案与 reference-duel 包。
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { WebSocket } from 'ws';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LOCAL_DOTNET = join(REPO, 'dogfood-output', 'dotnet', 'dotnet.exe');
const DOTNET = process.env.BP_DOTNET ?? (existsSync(LOCAL_DOTNET) ? LOCAL_DOTNET : 'dotnet');
const PACKAGED = process.env.BP_PACKAGED_APP === '1';
const EXE = process.env.BP_SUPERVISOR_EXE
  ?? (PACKAGED
    ? join(REPO, 'dist-win', '3178', 'bp-supervisor.exe')
    : join(REPO, 'apps', 'BattlePlatform.Supervisor', 'bin', 'Debug', 'net10.0-windows', 'bp-supervisor.exe'));
const tempRoot = mkdtempSync(join(tmpdir(), 'bp-supervisor-smoke-'));
const gamesDir = join(tempRoot, 'games');
const dataDir = join(tempRoot, 'data');
const pipeName = `bp-smoke-${randomBytes(4).toString('hex')}`;
const pipePath = `\\\\.\\pipe\\${pipeName}`;

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function buildIfNeeded() {
  if (!process.env.BP_SKIP_DOTNET_BUILD && !PACKAGED) {
    const result = spawnSync(DOTNET, ['build', 'BattlePlatform.sln', '-c', 'Debug'], {
      cwd: REPO,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error(`dotnet build 失败：${result.error?.message ?? `exit=${result.status}`}`);
    }
  }
}

async function buildGamePackage() {
  mkdirSync(gamesDir, { recursive: true });
  const cli = join(REPO, 'packages', 'bp-game', 'dist', 'cli.js');
  const result = spawnSync(process.execPath, [cli, 'build', 'examples/reference-duel', '--out', join(gamesDir, 'reference-duel.bpkg')], {
    cwd: REPO,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('bp-game build 失败');
}

function connectPipe(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise, reject) => {
    const attempt = () => {
      const socket = net.connect(pipePath);
      socket.once('connect', () => resolvePromise(socket));
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error('连接 Supervisor 管道超时'));
        else setTimeout(attempt, 50);
      });
    };
    attempt();
  });
}

function lineReader(socket) {
  let buffer = '';
  const queue = [];
  const waiters = [];
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      const value = JSON.parse(line);
      const waiter = waiters.shift();
      if (waiter) waiter(value);
      else queue.push(value);
    }
  });
  return {
    next(timeoutMs = 10000) {
      if (queue.length > 0) return Promise.resolve(queue.shift());
      return new Promise((resolvePromise, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.indexOf(onValue);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error('等待 Supervisor 消息超时'));
        }, timeoutMs);
        const onValue = (value) => {
          clearTimeout(timer);
          resolvePromise(value);
        };
        waiters.push(onValue);
      });
    },
    send(value) {
      socket.write(`${JSON.stringify(value)}\n`);
    },
  };
}

async function waitFor(reader, predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = await reader.next(deadline - Date.now());
    if (predicate(message)) return message;
  }
  throw new Error('等待 Supervisor 状态超时');
}

async function main() {
  buildIfNeeded();
  await buildGamePackage();

  const args = PACKAGED
    ? ['--pipe', pipeName, '--data-dir', dataDir, '--games-dir', gamesDir, '--game-port', '0']
    : [
      '--pipe', pipeName,
      '--root', REPO,
      '--node', process.execPath,
      '--service-entry', join(REPO, 'packages', 'session-service', 'dist', 'main.js'),
      '--data-dir', dataDir,
      '--games-dir', gamesDir,
      '--game-port', '0',
    ];
  const env = { ...process.env };
  if (existsSync(DOTNET)) env.DOTNET_ROOT = dirname(DOTNET);
  const supervisor = spawn(EXE, args, {
    cwd: PACKAGED ? join(REPO, 'dist-win', '3178') : REPO,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  const logs = [];
  supervisor.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  supervisor.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  const exited = new Promise((resolvePromise) => supervisor.once('exit', (code) => resolvePromise(code)));

  let socket = null;
  try {
    socket = await connectPipe(20000);
    const reader = lineReader(socket);
    reader.send({ type: 'hello', version: 1, clientKind: 'ui' });
    const welcome = await reader.next();
    if (welcome.type !== 'welcome' || welcome.version !== 1) throw new Error(`welcome 不合法：${JSON.stringify(welcome)}`);

    reader.send({ type: 'serviceStart' });
    const running = await waitFor(reader, (message) => message.type === 'serviceStatus' && message.state === 'running');
    if (!running.uiPort) throw new Error('serviceStatus 没有 uiPort');

    const health = await fetch(`http://127.0.0.1:${running.uiPort}/health`);
    if (!health.ok) throw new Error(`管理页 /health 失败：${health.status}`);

    const control = new WebSocket(`ws://127.0.0.1:${running.uiPort}/ws/control`);
    await new Promise((resolvePromise, reject) => {
      control.once('open', resolvePromise);
      control.once('error', reject);
    });
    const games = await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('listGames 超时')), 10000);
      control.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type !== 'gameList') return;
        clearTimeout(timer);
        resolvePromise(message.games);
      });
      control.send(JSON.stringify({ type: 'hello' }));
      control.send(JSON.stringify({ type: 'listGames' }));
    });
    control.close();
    if (!games.some((game) => game.id === 'reference-duel')) throw new Error('listGames 没有 reference-duel');

    reader.send({ type: 'serviceStop' });
    await waitFor(reader, (message) => message.type === 'serviceStatus' && message.state === 'stopped');

    reader.send({ type: 'shutdown' });
    socket.end();
    const code = await Promise.race([exited, sleep(10000).then(() => 'timeout')]);
    if (code === 'timeout') throw new Error('Supervisor 未在 shutdown 后退出');
    console.log(`supervisor smoke OK：uiPort=${running.uiPort} games=${games.length}`);
  } finally {
    socket?.destroy();
    if (supervisor.exitCode === null) supervisor.kill();
    if (!process.env.BP_KEEP_SMOKE) rmSync(tempRoot, { recursive: true, force: true });
    if (process.env.BP_KEEP_SMOKE || supervisor.exitCode !== 0) {
      process.stdout.write(logs.join(''));
    }
  }
}

main().catch((error) => {
  console.error(`supervisor smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
