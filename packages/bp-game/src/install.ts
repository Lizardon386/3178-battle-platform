import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readPackage, verifyPackageSignature, type PackageSignature } from '@bp/game-package';

export interface InstallPackageOptions {
  file: string;
  gamesDir: string;
  /** 非空时强制要求有效签名且由其中一把公钥验证。 */
  trustedKeys?: string[];
  force?: boolean;
}

export interface InstalledPackage {
  file: string;
  id: string;
  version: string;
  packageHash: string;
  signed: boolean;
  signatureValid: boolean;
}

const safeName = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'package';

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readSignature(pkgFile: string): Promise<PackageSignature | null> {
  try {
    return JSON.parse(await readFile(`${pkgFile}.sig`, 'utf8')) as PackageSignature;
  } catch {
    return null;
  }
}

/** 校验并复制到 games 目录；签名可选，给了 trustedKeys 就强制。 */
export async function installPackage(options: InstallPackageOptions): Promise<InstalledPackage> {
  const source = resolve(options.file);
  const pack = readPackage(source);
  const signature = await readSignature(source);
  if (options.trustedKeys && options.trustedKeys.length > 0) {
    if (!signature) throw new Error('缺少签名文件（<包>.sig）');
    if (!verifyPackageSignature(pack.packageHash, signature, options.trustedKeys)) {
      throw new Error('签名校验失败');
    }
  } else if (signature && !verifyPackageSignature(pack.packageHash, signature, [])) {
    throw new Error('签名与包内容不匹配');
  }

  const gamesDir = resolve(options.gamesDir);
  await mkdir(gamesDir, { recursive: true });
  const target = join(gamesDir, `${safeName(pack.manifest.id)}-${safeName(pack.manifest.version)}.bpkg`);
  if (!options.force && await exists(target)) {
    throw new Error(`已安装同名包，使用 --force 覆盖：${target}`);
  }
  const token = `${process.pid}-${randomBytes(4).toString('hex')}`;
  const tmp = `${target}.tmp-${token}`;
  const tmpSig = `${tmp}.sig`;
  await copyFile(source, tmp);
  if (signature) await writeFile(tmpSig, JSON.stringify(signature));
  if (options.force) await rm(target, { force: true });
  await rename(tmp, target);
  if (signature) {
    await rm(`${target}.sig`, { force: true });
    await rename(tmpSig, `${target}.sig`);
  } else {
    await rm(`${target}.sig`, { force: true });
  }
  return {
    file: target,
    id: pack.manifest.id,
    version: pack.manifest.version,
    packageHash: pack.packageHash,
    signed: signature !== null,
    signatureValid: signature ? verifyPackageSignature(pack.packageHash, signature, []) : false,
  };
}

export async function listInstalled(gamesDir: string): Promise<Array<InstalledPackage & { error?: string }>> {
  const dir = resolve(gamesDir);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.bpkg')).sort();
  } catch {
    return [];
  }
  const result: Array<InstalledPackage & { error?: string }> = [];
  for (const name of names) {
    const file = join(dir, name);
    try {
      const pack = readPackage(file);
      const signature = await readSignature(file);
      result.push({
        file,
        id: pack.manifest.id,
        version: pack.manifest.version,
        packageHash: pack.packageHash,
        signed: signature !== null,
        signatureValid: signature ? verifyPackageSignature(pack.packageHash, signature, []) : false,
      });
    } catch (error) {
      result.push({
        file,
        id: name,
        version: '',
        packageHash: '',
        signed: false,
        signatureValid: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

/** spec 支持 `id@version`、`id`（唯一时）或完整文件名；歧义时要求更精确。 */
export async function uninstallPackage(gamesDir: string, spec: string): Promise<string> {
  const installed = await listInstalled(gamesDir);
  const match = installed.filter((entry) => {
    if (entry.file.endsWith(spec)) return true;
    const key = `${entry.id}@${entry.version}`;
    return spec === key || (spec === entry.id && entry.error === undefined);
  });
  if (match.length === 0) throw new Error(`没有找到已安装包：${spec}`);
  if (match.length > 1) throw new Error(`匹配到多个包，请用 id@version：${match.map((entry) => `${entry.id}@${entry.version}`).join(', ')}`);
  const file = match[0]!.file;
  await rm(file, { force: true });
  await rm(`${file}.sig`, { force: true });
  return file;
}
