import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Ctrl+C 的收尾路径。
 * 用户要的是"按 Ctrl+C 之后窗口自己关，不问 Y/N"，这成立有两个条件：
 * ① .bat 不在前台（由 bat-entries.test.mjs 钉住）；
 * ② node 收到 SIGINT 后真的会落盘 + 删 run 记录 + 以 0 退出（这里验）。
 * Windows 上没法从外部把 Ctrl+C 投递给别人的控制台，所以用 --import 注入一个钩子，
 * 在壳自己的进程里 process.emit('SIGINT') —— 走的是同一个监听器，只是信号来源不同。
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * 端口不能写死：上一次跑留下的壳如果还占着那个口，本次子进程会 EADDRINUSE 立刻退出，
 * 于是这条测试在 400ms 内报"退出码不是 0"——看着像收尾坏了，其实是端口撞车。
 */
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

async function waitHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(400) });
      if (res.ok) return true;
    } catch {
      // 还没起，继续等
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

test('SIGINT 收尾：落盘、删掉 run 记录、退出码 0（窗口才会自己关）', async () => {
  const PORT = await freePort();
  const runFile = join(ROOT, 'data', `run-${PORT}.json`);
  if (existsSync(runFile)) rmSync(runFile);

  const hook = pathToFileURL(join(ROOT, 'packages/hostd/test/fixtures/sigint-after-boot.mjs')).href;
  const child = spawn(
    process.execPath,
    [join(ROOT, 'packages/hostd/dist/cli.js'), 'host', '--port', String(PORT), '--no-lan'],
    {
      env: { ...process.env, NODE_OPTIONS: `--import ${hook}`, BP_SIGINT_DELAY_MS: '1800' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let out = '';
  child.stdout.on('data', (b) => (out += b.toString()));
  child.stderr.on('data', (b) => (out += b.toString()));

  assert.ok(await waitHealth(PORT, 12_000), `壳没起来：${out}`);
  assert.ok(existsSync(runFile), `起来后应该有 data/run-${PORT}.json，否则收尾时无所谓删不删`);

  const exitCode = await new Promise((resolveExit) => {
    child.once('exit', (code) => resolveExit(code));
    setTimeout(() => resolveExit(null), 12_000);
  });

  assert.equal(exitCode, 0, `退出码应为 0（非 0 时窗口可能停在错误上）；输出：${out}`);
  assert.equal(existsSync(runFile), false, '收尾必须删掉自己的 run 记录，否则下次 stop 会去杀一个不存在的 pid');
  assert.match(out, /收到 SIGINT，正在收尾/, '要让人看见收尾确实跑了，而不是被硬杀');
  assert.equal(await waitHealth(PORT, 1_200), false, '端口必须真的释放，别让下次启动撞 EADDRINUSE');
});
