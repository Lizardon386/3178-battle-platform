import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const REQUIRED = ['3178.exe', 'bp-supervisor.exe'];

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readManifest(dir) {
  const file = join(dir, 'build-manifest.json');
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`读不到 build-manifest.json：${file}（${String(error)}）`);
  }
  if (!parsed || !Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error('build-manifest.json 缺少 files');
  }
  return parsed;
}

/** 逐个文件校验大小与 SHA-256；任何不一致都拒绝升级。 */
export async function verifyPackage(dir, manifest) {
  for (const entry of manifest.files) {
    const file = join(dir, ...entry.path.split('/'));
    let info;
    try {
      info = await stat(file);
    } catch {
      throw new Error(`包内缺少文件：${entry.path}`);
    }
    if (!info.isFile() || info.size !== entry.bytes) throw new Error(`文件大小不符：${entry.path}`);
    const hash = sha256(await readFile(file));
    if (hash !== entry.sha256) throw new Error(`文件哈希不符：${entry.path}`);
  }
  for (const required of REQUIRED) {
    if (!(await exists(join(dir, required)))) throw new Error(`包内缺少入口：${required}`);
  }
}

export function stamp(now = Date.now()) {
  return new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
}

/**
 * 就地升级：校验源包 → 复制到 staging 并复验 → 旧目录改名备份 → staging 顶上。
 * 目标目录必须已安装（含 3178.exe）；升级前应退出 3178，占用会直接报错。
 */
export async function applyUpgrade(options) {
  const target = options.target;
  const source = options.source;
  const now = options.now ?? Date.now();
  const manifest = await readManifest(source);
  await verifyPackage(source, manifest);
  if (!(await exists(join(target, '3178.exe')))) {
    throw new Error(`目标不是已安装目录（缺 3178.exe）：${target}`);
  }
  const label = `${basename(target)}-${stamp(now)}`;
  const staging = `${target}.staging-${label}`;
  const backup = `${target}.old-${label}`;
  await rm(staging, { recursive: true, force: true });
  await cp(source, staging, { recursive: true });
  await verifyPackage(staging, manifest);

  let movedOld = false;
  try {
    await rename(target, backup);
    movedOld = true;
    await rename(staging, target);
  } catch (error) {
    if (movedOld) {
      try {
        await rename(backup, target);
      } catch {
        // 恢复失败时保留备份目录，交由人工处理
      }
    }
    await rm(staging, { recursive: true, force: true });
    throw new Error(`升级切换失败（目标可能仍被占用）：${error instanceof Error ? error.message : String(error)}`);
  }
  await writeFile(join(target, 'upgrade.json'), `${JSON.stringify({
    version: manifest.version,
    commit: manifest.commit,
    appliedAt: new Date(now).toISOString(),
    previous: backup,
  }, null, 2)}\n`);
  return { target, backup, manifest };
}

async function latestBackup(target) {
  const parent = dirname(target);
  const prefix = `${basename(target)}.old-`;
  const names = (await readdir(parent)).filter((name) => name.startsWith(prefix)).sort();
  const last = names.at(-1);
  if (!last) throw new Error(`找不到 ${basename(target)}.old-* 备份目录`);
  const dir = join(parent, last);
  if (!(await exists(join(dir, '3178.exe')))) throw new Error(`备份目录不完整：${dir}`);
  return dir;
}

/** 回滚：当前目录改名留档，最近的备份顶回 target。 */
export async function rollbackUpgrade(options) {
  const target = options.target;
  const now = options.now ?? Date.now();
  let backup = options.backup;
  if (!backup) {
    try {
      const record = JSON.parse(await readFile(join(target, 'upgrade.json'), 'utf8'));
      if (record.previous && await exists(record.previous)) backup = record.previous;
    } catch {
      // 没有 upgrade.json 时退回到扫描备份目录
    }
  }
  backup ??= await latestBackup(target);
  const failed = `${target}.failed-${basename(target)}-${stamp(now)}`;
  await rename(target, failed);
  try {
    await rename(backup, target);
  } catch (error) {
    await rename(failed, target);
    throw new Error(`回滚失败：${error instanceof Error ? error.message : String(error)}`);
  }
  return { target, backup, failed };
}

export async function checkInstall(target) {
  const manifest = await readManifest(target);
  await verifyPackage(target, manifest);
  return manifest;
}
