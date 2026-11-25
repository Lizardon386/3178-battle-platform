#!/usr/bin/env node
/** 便携目录升级/回滚 CLI；安装器用户可直接重装，本工具面向 zip/便携分发。 */
import { resolve } from 'node:path';
import { applyUpgrade, checkInstall, rollbackUpgrade } from './upgrade-lib.mjs';

const args = process.argv.slice(2);
const command = args[0];
const flags = new Map();
for (let index = 1; index < args.length; index += 1) {
  const arg = args[index];
  if (!arg.startsWith('--')) continue;
  const name = arg.slice(2);
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`参数 --${name} 缺少值`);
  flags.set(name, value);
  index += 1;
}

const target = flags.get('target');
if (!target) throw new Error('需要 --target <安装目录>');
const resolved = resolve(target);

if (command === 'apply') {
  const source = flags.get('source');
  if (!source) throw new Error('apply 需要 --source <新版本目录>');
  const result = await applyUpgrade({ target: resolved, source: resolve(source) });
  console.log(`已升级 ${result.target} → ${result.manifest.version}（备份 ${result.backup}）`);
} else if (command === 'rollback') {
  const result = await rollbackUpgrade({ target: resolved, ...(flags.get('backup') ? { backup: resolve(flags.get('backup')) } : {}) });
  console.log(`已回滚 ${result.target}（当前版本留档 ${result.failed}）`);
} else if (command === 'check') {
  const manifest = await checkInstall(resolved);
  console.log(`OK ${manifest.version} ${manifest.commit ?? ''}`.trim());
} else {
  console.log(`用法：
  upgrade.mjs apply    --target <安装目录> --source <新版本目录>
  upgrade.mjs rollback --target <安装目录> [--backup <备份目录>]
  upgrade.mjs check    --target <安装目录>`);
  process.exitCode = command ? 1 : 0;
}
