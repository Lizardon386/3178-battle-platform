import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPackage, openGameRegistry } from '@bp/game-package';
import { startService } from '../dist/compose.js';

const freePort = async () => {
  const server = net.createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolvePromise) => server.close(() => resolvePromise()));
  return port;
};

const occupy = async () => {
  const server = net.createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    port,
    close: () => new Promise((resolvePromise) => server.close(() => resolvePromise())),
  };
};

async function tinyPackage(root) {
  const source = join(root, 'source');
  await mkdir(join(source, 'web'), { recursive: true });
  await writeFile(join(source, 'authority.js'), 'module.exports = {};\n');
  await writeFile(join(source, 'web', 'index.html'), '<!doctype html><title>fault</title>\n');
  await writeFile(join(source, 'reference.json'), '{"name":"fault"}\n');
  const outFile = join(root, 'fault.bpkg');
  buildPackage({
    root: source,
    manifest: {
      id: 'fault-game',
      name: '故障夹具',
      version: '1.0.0',
      platformRequirements: { protocolVersion: 1, minPlayers: 2, maxPlayers: 2 },
      entryPoints: { authority: 'authority.js', web: 'web/index.html' },
      sessionConfig: { fields: [] },
      reference: { entry: 'reference.json' },
    },
    outFile,
  });
  return outFile;
}

test('管理端口被占用：启动失败且不遗留监听', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bp-fault-port-'));
  const blocker = await occupy();
  try {
    await assert.rejects(() => startService({ dataDir, port: blocker.port }), /EADDRINUSE|listen/i);
  } finally {
    await blocker.close();
  }
  const check = net.createServer();
  await new Promise((resolvePromise, reject) => {
    check.once('error', reject);
    check.listen(blocker.port, '127.0.0.1', resolvePromise);
  });
  await new Promise((resolvePromise) => check.close(() => resolvePromise()));
});

test('游戏端口被占用：释放已监听的管理端口', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-fault-gameport-'));
  const outFile = await tinyPackage(root);
  const managementPort = await freePort();
  const blocker = await occupy();
  try {
    const registry = openGameRegistry({ packages: [outFile], cacheRoot: join(root, 'cache') });
    await assert.rejects(
      () => startService({
        dataDir: join(root, 'data'),
        port: managementPort,
        registry,
        gameOrigin: { port: blocker.port },
      }),
      /EADDRINUSE|listen/i,
    );
  } finally {
    await blocker.close();
  }
  const check = net.createServer();
  await new Promise((resolvePromise, reject) => {
    check.once('error', reject);
    check.listen(managementPort, '127.0.0.1', resolvePromise);
  });
  await new Promise((resolvePromise) => check.close(() => resolvePromise()));
});

test('游戏目录缺失或含坏包：注册表直接拒绝', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-fault-registry-'));
  assert.throws(
    () => openGameRegistry({ directories: [join(root, 'missing')], cacheRoot: join(root, 'cache') }),
    /读不到游戏包目录/,
  );
  const badDir = join(root, 'bad');
  await mkdir(badDir, { recursive: true });
  await writeFile(join(badDir, 'broken.bpkg'), 'not a package');
  assert.throws(
    () => openGameRegistry({ directories: [badDir], cacheRoot: join(root, 'cache') }),
    /不是游戏包/,
  );
});
