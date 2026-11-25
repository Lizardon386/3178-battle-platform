#!/usr/bin/env node
/**
 * 浏览器 smoke：真实 Chrome/Edge 打开管理端与游戏页，完成建房、加入、开始、出牌。
 * 不下载 Playwright 浏览器，使用系统已安装的 Chrome（Linux CI）或 Edge（Windows）。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { openGameRegistry } from '@bp/game-package';
import { startService } from '../../packages/session-service/dist/compose.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = mkdtempSync(join(tmpdir(), 'bp-web-smoke-'));

async function launchBrowser() {
  const channels = process.env.BP_BROWSER_CHANNEL
    ? [process.env.BP_BROWSER_CHANNEL]
    : process.platform === 'win32' ? ['msedge', 'chrome'] : ['chrome', 'msedge'];
  let lastError;
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`找不到可用的 Chrome/Edge：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function main() {
  const gamesDir = join(tempRoot, 'games');
  const dataDir = join(tempRoot, 'data');
  const cli = join(REPO, 'packages', 'bp-game', 'dist', 'cli.js');
  const built = spawnSync(process.execPath, [cli, 'build', 'examples/reference-duel', '--out', join(gamesDir, 'reference-duel.bpkg')], {
    cwd: REPO,
    stdio: 'inherit',
  });
  if (built.status !== 0) throw new Error('构建 reference-duel 失败');

  const registry = openGameRegistry({ packages: [join(gamesDir, 'reference-duel.bpkg')], cacheRoot: join(dataDir, 'packages') });
  const service = await startService({ dataDir, port: 0, registry, gameOrigin: { port: 0 } });
  const browser = await launchBrowser();
  const base = `http://127.0.0.1:${service.port}`;
  try {
    const host = await browser.newPage();
    const guest = await browser.newPage();
    await host.goto(base);
    await guest.goto(base);
    await host.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('已连接'));
    await guest.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('已连接'));

    await host.click('#create');
    await host.waitForFunction(() => document.querySelector('#session')?.textContent?.includes('"sessionId"'));
    const session = JSON.parse(await host.locator('#session').textContent());

    const answers = [session.sessionId, session.code];
    guest.on('dialog', (dialog) => dialog.accept(answers.shift() ?? ''));
    await guest.click('#join');
    await guest.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('已入座'));

    await host.click('#channel');
    await host.waitForSelector('#game a');
    const gameUrl = await host.locator('#game a').getAttribute('href');
    if (!gameUrl) throw new Error('没有拿到游戏地址');

    await guest.click('#channel');
    await guest.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('数据通道已就绪'));

    await host.click('#start');
    await host.waitForFunction(() => document.querySelector('#session')?.textContent?.includes('"gameProcess": "running"'));

    const game = await browser.newPage();
    game.on('console', (message) => console.log(`[game ${message.type()}] ${message.text()}`));
    game.on('pageerror', (error) => console.log(`[game pageerror] ${error.message}`));
    await game.goto(gameUrl);
    try {
      await game.waitForSelector('.card', { timeout: 15000 });
    } catch (error) {
      console.log(`[game status] ${await game.locator('#status').textContent().catch(() => '?')}`);
      throw error;
    }
    await game.locator('.card').first().click();

    await guest.waitForFunction(() => document.querySelector('#view')?.textContent?.includes('回合 2'), null, { timeout: 15000 });
    console.log('web smoke OK：浏览器完成建房/加入/开始/出牌');
  } finally {
    await browser.close();
    await service.close();
  }
}

main().catch((error) => {
  console.error(`web smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}).finally(() => {
  if (!process.env.BP_KEEP_SMOKE) rmSync(tempRoot, { recursive: true, force: true });
});
