#!/usr/bin/env node
/** 通用 .NET 测试入口：优先本地 SDK，CI 用 PATH 里的 dotnet。 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LOCAL = join(REPO, 'dogfood-output', 'dotnet', 'dotnet.exe');
const dotnet = process.env.BP_DOTNET ?? (existsSync(LOCAL) ? LOCAL : 'dotnet');
const project = process.argv[2];
if (!project) {
  console.error('用法：node tools/checks/run-dotnet-tests.mjs <测试项目.csproj> [额外 dotnet test 参数]');
  process.exit(2);
}
const env = { ...process.env };
if (existsSync(dotnet)) env.DOTNET_ROOT = dirname(dotnet);

const result = spawnSync(dotnet, ['test', project, '-c', 'Debug', ...process.argv.slice(3)], {
  cwd: REPO,
  stdio: 'inherit',
  env,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
