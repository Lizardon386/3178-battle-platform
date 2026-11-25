#!/usr/bin/env node
/** 运行 FlaUI/原生三条关键路径；需要交互式 Windows 桌面与 .NET SDK。 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LOCAL = join(REPO, 'dogfood-output', 'dotnet', 'dotnet.exe');
const dotnet = process.env.BP_DOTNET ?? (existsSync(LOCAL) ? LOCAL : 'dotnet');
const env = { ...process.env };
if (existsSync(dotnet)) env.DOTNET_ROOT = dirname(dotnet);

const result = spawnSync(dotnet, [
  'test',
  'tests/BattlePlatform.UiTests/BattlePlatform.UiTests.csproj',
  '-c', 'Debug',
  ...process.argv.slice(2),
], { cwd: REPO, stdio: 'inherit', env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
