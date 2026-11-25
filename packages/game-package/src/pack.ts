import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { validateManifest, type GameManifest } from './manifest.js';

/**
 * `.bpkg` 单文件游戏包（v1）：
 *   "BPKG1\n" + uint32LE 包头长度 + JSON 包头 { format, manifest, files[] } + 按清单顺序拼接的文件段。
 * 不压缩；读包时逐段校验 SHA-256。旧 `.bpmap` 明确拒绝，不做兼容层。
 */
export const PACKAGE_FORMAT = 1;
export const PACKAGE_MAGIC = 'BPKG1\n';
export const PACKAGE_EXTENSION = '.bpkg';
export const PACKAGE_MARKER = '.bpkg-ok';
export const LEGACY_PACK_MAGIC = 'BPMAP1\n';

export const MAX_HEADER_BYTES = 1 << 20;
export const MAX_FILE_BYTES = 64 << 20;
export const MAX_TOTAL_BYTES = 256 << 20;
export const MAX_FILES = 512;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RESERVED_PATHS = new Set([PACKAGE_MARKER, 'bpkg.json']);

export class PackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageError';
  }
}

export interface PackageFileEntry {
  path: string;
  sha256: string;
  bytes: number;
}

export interface PackageFile {
  path: string;
  bytes: Buffer;
}

export interface LoadedPackage {
  manifest: GameManifest;
  files: PackageFile[];
  packageHash: string;
  source: string;
}

export interface BuiltPackage {
  manifest: GameManifest;
  files: PackageFileEntry[];
  packageHash: string;
  source: string;
}

export interface ExtractResult {
  dir: string;
  packageHash: string;
  reused: boolean;
}

function fail(message: string): never {
  throw new PackageError(message);
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 包内相对路径：拒绝绝对路径、反斜杠、控制字符、`.`/`..` 段与保留名。 */
export function assertPackagePath(value: unknown, where = '包内路径'): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${where}为空`);
  if (value.length > 256) fail(`${where}过长：${value.slice(0, 40)}…`);
  if (value.includes('\\')) fail(`${where}不能含反斜杠：${value}`);
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) fail(`${where}不能是绝对路径：${value}`);
  if (/[\u0000-\u001f]/.test(value)) fail(`${where}含控制字符：${value}`);
  for (const part of value.split('/')) {
    if (!part || part === '.' || part === '..') fail(`${where}不合法：${value}`);
  }
  if (RESERVED_PATHS.has(value.toLowerCase())) fail(`${where}是保留名：${value}`);
  return value;
}

function validateFileEntries(raw: unknown): PackageFileEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) fail('包内没有文件');
  if (raw.length > MAX_FILES) fail(`包内文件过多：${raw.length}`);
  const seen = new Set<string>();
  const files: PackageFileEntry[] = [];
  let total = 0;
  for (const item of raw) {
    if (!isRecord(item)) fail('文件条目不是对象');
    for (const key of Object.keys(item)) {
      if (key !== 'path' && key !== 'sha256' && key !== 'bytes') fail(`文件条目含未知字段：${key}`);
    }
    const path = assertPackagePath(item.path);
    const key = path.toLowerCase();
    if (seen.has(key)) fail(`包内路径重复（Windows 不区分大小写）：${path}`);
    seen.add(key);
    const bytes = item.bytes;
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) fail(`文件大小不合法：${path}`);
    if (bytes > MAX_FILE_BYTES) fail(`文件过大：${path}`);
    const sha256 = item.sha256;
    if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) fail(`文件哈希不合法：${path}`);
    total += bytes;
    if (total > MAX_TOTAL_BYTES) fail('包体积超过上限');
    files.push({ path, sha256, bytes });
  }
  return files;
}

function assertEntryPointsPresent(manifest: GameManifest, paths: Set<string>): void {
  const require = (path: string, label: string): void => {
    if (!paths.has(path.toLowerCase())) fail(`${label}不在文件清单里：${path}`);
  };
  require(manifest.entryPoints.authority, 'Authority 入口');
  if (manifest.entryPoints.web) require(manifest.entryPoints.web, 'Web 入口');
  require(manifest.reference.entry, '资料文档');
  for (const asset of manifest.assets ?? []) require(asset.path, '清单资产');
}

function assertDeclaredAssetsMatch(manifest: GameManifest, files: PackageFileEntry[]): void {
  for (const asset of manifest.assets ?? []) {
    const actual = files.find((file) => file.path.toLowerCase() === asset.path.toLowerCase());
    if (!actual) fail(`清单资产不在包里：${asset.path}`);
    if (actual.sha256 !== asset.sha256 || actual.bytes !== asset.bytes) {
      fail(`清单资产与包内文件不一致：${asset.path}`);
    }
  }
}

interface CollectedFile {
  path: string;
  bytes: Buffer;
}

function collectSourceFiles(root: string): CollectedFile[] {
  const rootAbs = resolve(root);
  let rootStat;
  try {
    rootStat = statSync(rootAbs);
  } catch {
    fail(`读不到源目录：${root}`);
  }
  if (!rootStat.isDirectory()) fail(`源路径不是目录：${root}`);

  const collected = new Map<string, CollectedFile>();
  let total = 0;
  const walk = (absoluteDir: string): void => {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const absolute = join(absoluteDir, entry.name);
      const rel = relative(rootAbs, absolute).replace(/\\/g, '/');
      if (entry.isSymbolicLink()) fail(`源目录不能含符号链接：${rel}`);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (RESERVED_PATHS.has(rel.toLowerCase())) continue;
      const path = assertPackagePath(rel);
      const key = path.toLowerCase();
      if (collected.has(key)) fail(`源目录路径重复（Windows 不区分大小写）：${path}`);
      if (collected.size >= MAX_FILES) fail(`包内文件过多：超过 ${MAX_FILES}`);
      const bytes = readFileSync(absolute);
      if (bytes.length > MAX_FILE_BYTES) fail(`文件过大：${path}`);
      total += bytes.length;
      if (total > MAX_TOTAL_BYTES) fail('包体积超过上限');
      collected.set(key, { path, bytes });
    }
  };
  walk(rootAbs);
  return [...collected.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export interface BuildPackageOptions {
  root: string;
  manifest: unknown;
  outFile: string;
}

/** 从目录构建 `.bpkg`；manifest 先校验，再与真实文件核对入口与声明资产。 */
export function buildPackage(options: BuildPackageOptions): BuiltPackage {
  const manifest = validateManifest(options.manifest);
  const collected = collectSourceFiles(options.root);
  const entries: PackageFileEntry[] = collected.map((file) => ({
    path: file.path,
    sha256: sha256Hex(file.bytes),
    bytes: file.bytes.length,
  }));
  assertEntryPointsPresent(manifest, new Set(entries.map((entry) => entry.path.toLowerCase())));
  assertDeclaredAssetsMatch(manifest, entries);

  const header = Buffer.from(JSON.stringify({ format: PACKAGE_FORMAT, manifest, files: entries }), 'utf8');
  if (header.length > MAX_HEADER_BYTES) fail('包头过大');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length, 0);
  const packed = Buffer.concat([
    Buffer.from(PACKAGE_MAGIC, 'latin1'),
    length,
    header,
    ...collected.map((file) => file.bytes),
  ]);

  const outFile = resolve(options.outFile);
  mkdirSync(dirname(outFile), { recursive: true });
  const temp = `${outFile}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(temp, packed);
    if (existsSync(outFile)) unlinkSync(outFile);
    renameSync(temp, outFile);
  } catch (error) {
    try {
      rmSync(temp, { force: true });
    } catch {
      // 临时文件清不掉不改变“打包失败”这个结论
    }
    throw error;
  }
  return { manifest, files: entries, packageHash: sha256Hex(packed), source: outFile };
}

/** 读取并完整校验 `.bpkg`；旧的 `.bpmap` 在魔数处直接拒绝。 */
export function readPackage(filePath: string, options: { maxTotalBytes?: number } = {}): LoadedPackage {
  const maxTotal = options.maxTotalBytes ?? MAX_TOTAL_BYTES;
  let fileSize: number;
  try {
    fileSize = statSync(filePath).size;
  } catch {
    fail(`读不到游戏包：${filePath}`);
  }
  if (fileSize > maxTotal + MAX_HEADER_BYTES + PACKAGE_MAGIC.length + 4) fail(`包太大：${fileSize} 字节`);
  let raw: Buffer;
  try {
    raw = readFileSync(filePath);
  } catch {
    fail(`读不到游戏包：${filePath}`);
  }
  if (raw.length >= LEGACY_PACK_MAGIC.length && raw.subarray(0, LEGACY_PACK_MAGIC.length).toString('latin1') === LEGACY_PACK_MAGIC) {
    fail(`旧 .bpmap 包不受支持，请用 .bpkg 重新打包：${filePath}`);
  }
  if (raw.length < PACKAGE_MAGIC.length + 4) fail('不是游戏包：文件太短');
  if (raw.subarray(0, PACKAGE_MAGIC.length).toString('latin1') !== PACKAGE_MAGIC) fail('不是游戏包：魔数不对');
  const headerLength = raw.readUInt32LE(PACKAGE_MAGIC.length);
  if (headerLength === 0 || headerLength > MAX_HEADER_BYTES) fail(`包头长度不合法：${headerLength}`);
  const headerStart = PACKAGE_MAGIC.length + 4;
  const dataStart = headerStart + headerLength;
  if (dataStart > raw.length) fail('包头长度超过文件大小');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.subarray(headerStart, dataStart).toString('utf8'));
  } catch {
    fail('包头不是合法 JSON');
  }
  if (!isRecord(parsed)) fail('包头不是对象');
  if (parsed.format !== PACKAGE_FORMAT) fail(`不支持的包格式：${String(parsed.format)}`);
  for (const key of Object.keys(parsed)) {
    if (key !== 'format' && key !== 'manifest' && key !== 'files') fail(`包头含未知字段：${key}`);
  }
  const manifest = validateManifest(parsed.manifest);
  const entries = validateFileEntries(parsed.files);
  const declaredTotal = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (declaredTotal > maxTotal) fail(`包体积超过上限：${declaredTotal} > ${maxTotal}`);
  assertEntryPointsPresent(manifest, new Set(entries.map((entry) => entry.path.toLowerCase())));
  assertDeclaredAssetsMatch(manifest, entries);

  const files: PackageFile[] = [];
  let offset = dataStart;
  for (const entry of entries) {
    const end = offset + entry.bytes;
    if (end > raw.length) fail(`文件段超出包尾：${entry.path}`);
    const bytes = raw.subarray(offset, end);
    if (sha256Hex(bytes) !== entry.sha256) fail(`文件校验失败：${entry.path}`);
    files.push({ path: entry.path, bytes });
    offset = end;
  }
  if (offset !== raw.length) fail(`包尾还有未声明的 ${raw.length - offset} 字节`);

  return { manifest, files, packageHash: sha256Hex(raw), source: filePath };
}

function markerMatches(file: string, packageHash: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { packageHash?: unknown };
    return parsed.packageHash === packageHash;
  } catch {
    return false;
  }
}

function listExtracted(dir: string, prefix = ''): string[] {
  const files: string[] = [];
  const base = prefix ? join(dir, ...prefix.split('/')) : dir;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      files.push(path);
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...listExtracted(dir, path));
      continue;
    }
    if (entry.isFile() && path !== PACKAGE_MARKER) files.push(path);
  }
  return files.sort();
}

function extractedMatches(dir: string, pack: LoadedPackage): boolean {
  const expected = pack.files.map((entry) => entry.path).sort();
  const actual = listExtracted(dir);
  if (actual.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    if (actual[i] !== expected[i]) return false;
  }
  for (const entry of pack.files) {
    try {
      const bytes = readFileSync(join(dir, ...entry.path.split('/')));
      if (sha256Hex(bytes) !== sha256Hex(entry.bytes)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** 解包到内容寻址缓存；成功目录带 `.bpkg-ok` 标记，复用时重新核对全部哈希。 */
export function extractPackage(pack: LoadedPackage, cacheRoot: string): ExtractResult {
  const finalDir = join(cacheRoot, pack.manifest.id, pack.packageHash);
  const marker = join(finalDir, PACKAGE_MARKER);
  if (existsSync(marker) && markerMatches(marker, pack.packageHash) && extractedMatches(finalDir, pack)) {
    return { dir: finalDir, packageHash: pack.packageHash, reused: true };
  }
  if (existsSync(finalDir)) {
    const aside = `${finalDir}.broken-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    renameSync(finalDir, aside);
  }

  const tmpRoot = join(cacheRoot, '.tmp');
  mkdirSync(tmpRoot, { recursive: true });
  const tmpDir = join(tmpRoot, `${pack.manifest.id}-${pack.packageHash.slice(0, 12)}-${randomBytes(4).toString('hex')}`);
  try {
    for (const file of pack.files) {
      const target = resolve(tmpDir, ...file.path.split('/'));
      const tmpAbs = resolve(tmpDir);
      if (target !== tmpAbs && !target.startsWith(`${tmpAbs}${sep}`)) fail(`解包路径越界：${file.path}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.bytes);
    }
    writeFileSync(
      join(tmpDir, PACKAGE_MARKER),
      JSON.stringify({ packageHash: pack.packageHash, id: pack.manifest.id, version: pack.manifest.version }),
      'utf8',
    );
    mkdirSync(dirname(finalDir), { recursive: true });
    renameSync(tmpDir, finalDir);
  } catch (error) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 失败路径不掩盖原始错误
    }
    throw error;
  }
  return { dir: finalDir, packageHash: pack.packageHash, reused: false };
}
