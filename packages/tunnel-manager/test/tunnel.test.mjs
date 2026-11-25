import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { CloudflareTunnel, TunnelError, TunnelManager } from '../dist/index.js';

function fakeSpawner() {
  const procs = [];
  return {
    procs,
    start(config, binaryPath, env) {
      const proc = new EventEmitter();
      proc.pid = 4242;
      proc.stdout = new PassThrough();
      proc.stderr = new PassThrough();
      proc.onExit = (listener) => proc.once('exit', listener);
      proc.kill = () => proc.emit('exit', 0, null);
      procs.push({ name: config.name, config, binaryPath, env, proc });
      return proc;
    },
  };
}

const byName = (spawner, name) => spawner.procs.filter((entry) => entry.name === name).at(-1);

const waitForProc = async (spawner, name) => {
  for (let index = 0; index < 200; index += 1) {
    const entry = byName(spawner, name);
    if (entry) return entry;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
  throw new Error(`没有等到 ${name} 的进程`);
};

test('quick：解析 trycloudflare URL，隔离环境，停止后回到 stopped', async () => {
  const spawner = fakeSpawner();
  const tunnel = new CloudflareTunnel({
    name: 'game', mode: 'quick', localPort: 3179, binaryPath: 'cloudflared', spawner, startTimeoutMs: 1000,
  });
  const starting = tunnel.start();
  const entry = await waitForProc(spawner, 'game');
  assert.equal(entry.config.localPort, 3179);
  assert.equal(entry.binaryPath, 'cloudflared');
  assert.equal(typeof entry.env.HOME, 'string');
  assert.equal(entry.env.NO_AUTOUPDATE, 'true');
  assert.equal(entry.env.TUNNEL_TOKEN, undefined);
  entry.proc.stdout.write('INF +--------------------------------------------------------------------------------------------+\n');
  entry.proc.stdout.write('INF |  https://calm-river-1234.trycloudflare.com                                             |\n');
  const status = await starting;
  assert.equal(status.phase, 'ready');
  assert.equal(status.publicUrl, 'https://calm-river-1234.trycloudflare.com');
  await tunnel.stop();
  assert.equal(tunnel.getStatus().phase, 'stopped');
  assert.equal(tunnel.getStatus().publicUrl, null);
});

test('named：缺 token 或 hostname 直接拒绝', () => {
  assert.throws(() => new CloudflareTunnel({
    name: 'mgmt', mode: 'named', localPort: 3178, hostname: 'game.example.com', binaryPath: 'x', spawner: fakeSpawner(),
  }), (error) => error instanceof TunnelError && error.code === 'token');
  assert.throws(() => new CloudflareTunnel({
    name: 'mgmt', mode: 'named', localPort: 3178, token: 'a'.repeat(24), binaryPath: 'x', spawner: fakeSpawner(),
  }), (error) => error instanceof TunnelError && error.code === 'configuration');
});

test('named：token 只进环境变量，就绪后给出固定 hostname', async () => {
  const spawner = fakeSpawner();
  const tunnel = new CloudflareTunnel({
    name: 'mgmt', mode: 'named', localPort: 3178, token: 'a'.repeat(24),
    hostname: 'game.example.com', binaryPath: 'x', spawner, namedReadyDelayMs: 10,
  });
  const starting = tunnel.start();
  const entry = await waitForProc(spawner, 'mgmt');
  const status = await starting;
  assert.equal(entry.env.TUNNEL_TOKEN, 'a'.repeat(24));
  assert.deepEqual(entry.config.token, 'a'.repeat(24));
  assert.equal(status.phase, 'ready');
  assert.equal(status.publicUrl, 'https://game.example.com');
  await tunnel.stop();
});

test('超时：未拿到 URL 判为 timeout，进程退出判为 runtime', async () => {
  const spawner = fakeSpawner();
  const tunnel = new CloudflareTunnel({
    name: 't', mode: 'quick', localPort: 3200, binaryPath: 'x', spawner, startTimeoutMs: 30,
  });
  await assert.rejects(() => tunnel.start(), (error) => error instanceof TunnelError && error.code === 'timeout');
  assert.equal(tunnel.getStatus().phase, 'failed');
  await tunnel.stop();

  const spawner2 = fakeSpawner();
  const tunnel2 = new CloudflareTunnel({
    name: 't2', mode: 'quick', localPort: 3201, binaryPath: 'x', spawner: spawner2, startTimeoutMs: 1000,
  });
  const starting = tunnel2.start();
  const proc2 = await waitForProc(spawner2, 't2');
  proc2.proc.emit('exit', 1, null);
  await assert.rejects(() => starting, (error) => error instanceof TunnelError && error.code === 'runtime');
  await tunnel2.stop();
});

test('管理器：两条隧道独立启停，URL 变化会广播', async () => {
  const spawner = fakeSpawner();
  const manager = new TunnelManager({ binaryPath: 'x', spawner, startTimeoutMs: 1000 });
  manager.register('management', { mode: 'quick', localPort: 3178 });
  manager.register('game', { mode: 'quick', localPort: 3179 });
  const urls = [];
  manager.onChange((status) => {
    if (status.phase === 'ready' && status.publicUrl) urls.push(`${status.name}=${status.publicUrl}`);
  });

  const a = manager.start('management');
  const managementProc = await waitForProc(spawner, 'management');
  managementProc.proc.stdout.write('https://a-111.trycloudflare.com\n');
  await a;
  const b = manager.start('game');
  const gameProc = await waitForProc(spawner, 'game');
  gameProc.proc.stdout.write('https://b-222.trycloudflare.com\n');
  await b;
  assert.deepEqual(manager.statusAll().map((status) => status.phase), ['ready', 'ready']);
  assert.deepEqual(urls, ['management=https://a-111.trycloudflare.com', 'game=https://b-222.trycloudflare.com']);

  await manager.stop('management');
  assert.equal(manager.status('management').phase, 'stopped');
  assert.equal(manager.status('game').phase, 'ready');
  await manager.stopAll();
  assert.ok(manager.statusAll().every((status) => status.phase === 'stopped'));
});
