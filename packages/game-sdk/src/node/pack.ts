import { createHash, randomBytes } from 'node:crypto';
import { API_VERSION, DEFAULT_MODE } from '@bp/core-abi';
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

/**
 * 单文件游戏包：魔数 + 4 字节包头长度 + JSON 包头 + 按清单顺序拼接的文件段。
 * 包头里给每个文件记 size 与 sha256，读包时逐段校验；不压缩，避免第一版引入额外复杂度。
 */
export const PACK_FORMAT = 1;
export const PACK_MAGIC = 'BPMAP1\n';
export const PACK_EXTENSION = '.bpmap';
export const PACK_MARKER = '.bpmap-ok';

const MAX_HEADER_BYTES = 1 << 20;
const MAX_FILE_BYTES = 64 << 20;
const MAX_TOTAL_BYTES = 256 << 20;
const MAX_FILES = 512;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const VERSION_PATTERN = /^\S{1,64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackError';
  }
}

export interface PackFileEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface PackManifest {
  format: number;
  id: string;
  version: string;
  mode: string;
  apiVersion: number;
  server: string;
  client?: string;
  files: PackFileEntry[];
}

export interface PackFile {
  path: string;
  bytes: Buffer;
}

export interface LoadedPack {
  manifest: PackManifest;
  files: PackFile[];
  packageHash: string;
  source: string;
}

export interface PackSource {
  id: string;
  version: string;
  mode?: string;
  apiVersion?: number;
  server: string;
  client?: string;
}

export interface ExtractResult {
  dir: string;
  packageHash: string;
  reused: boolean;
}

function fail(message: string): never {
  throw new PackError(message);
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function assertPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) fail('包内路径为空');
  if (value.length > 256) fail(`包内路径过长：${value.slice(0, 40)}…`);
  if (value.includes('\\')) fail(`包内路径不能含反斜杠：${value}`);
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) fail(`包内路径不能是绝对路径：${value}`);
  if (/[\u0000-\u001f]/.test(value)) fail(`包内路径含控制字符：${value}`);
  const parts = value.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..') fail(`包内路径不合法：${value}`);
  }
  if (value === PACK_MARKER || value === 'bpmap.json') fail(`包内路径是保留名：${value}`);
  return value;
}

function readMode(value: unknown): string {
  if (value === undefined) return DEFAULT_MODE;
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 32) fail('包 mode 不合法');
  return value.trim();
}

function readApiVersion(value: unknown): number {
  if (value === undefined) return API_VERSION;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail('包 apiVersion 不合法');
  return value;
}

function assertSource(source: PackSource): PackSource {
  if (!ID_PATTERN.test(source.id)) fail('包 id 不合法（只允许小写字母、数字、连字符）');
  if (!VERSION_PATTERN.test(source.version)) fail('包 version 不合法');
  const server = assertPath(source.server);
  const client = source.client === undefined ? undefined : assertPath(source.client);
  return {
    id: source.id,
    version: source.version,
    ...(source.mode === undefined ? {} : { mode: readMode(source.mode) }),
    ...(source.apiVersion === undefined ? {} : { apiVersion: readApiVersion(source.apiVersion) }),
    server,
    ...(client ? { client } : {}),
  };
}

function validateManifest(value: unknown): PackManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('包头不是对象');
  const raw = value as Record<string, unknown>;
  if (raw.format !== PACK_FORMAT) fail(`不支持的包格式：${String(raw.format)}`);
  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) fail('包 id 不合法');
  if (typeof raw.version !== 'string' || !VERSION_PATTERN.test(raw.version)) fail('包 version 不合法');
  const mode = readMode(raw.mode);
  const apiVersion = readApiVersion(raw.apiVersion);
  const server = assertPath(raw.server);
  const client = raw.client === undefined ? undefined : assertPath(raw.client);
  if (!Array.isArray(raw.files) || raw.files.length === 0) fail('包内没有文件');
  if (raw.files.length > MAX_FILES) fail(`包内文件过多：${raw.files.length}`);

  const seen = new Set<string>();
  const files: PackFileEntry[] = [];
  let total = 0;
  for (const item of raw.files) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('文件条目不是对象');
    const entry = item as Record<string, unknown>;
    const path = assertPath(entry.path);
    const key = path.toLowerCase();
    if (seen.has(key)) fail(`包内路径重复（Windows 不区分大小写）：${path}`);
    seen.add(key);
    if (typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size) || entry.size < 0) {
      fail(`文件大小不合法：${path}`);
    }
    if (entry.size > MAX_FILE_BYTES) fail(`文件过大：${path}`);
    if (typeof entry.sha256 !== 'string' || !SHA256_PATTERN.test(entry.sha256)) {
      fail(`文件哈希不合法：${path}`);
    }
    total += entry.size;
    if (total > MAX_TOTAL_BYTES) fail('包体积超过上限');
    files.push({ path, size: entry.size, sha256: entry.sha256 });
  }
  if (!seen.has(server.toLowerCase())) fail(`服务端入口不在文件清单里：${server}`);
  if (client && !seen.has(client.toLowerCase())) fail(`客户端入口不在文件清单里：${client}`);

  return {
    format: PACK_FORMAT,
    id: raw.id,
    version: raw.version,
    mode,
    apiVersion,
    server,
    ...(client ? { client } : {}),
    files,
  };
}

export function readPack(filePath: string, options: { maxTotalBytes?: number } = {}): LoadedPack {
  const maxTotal = options.maxTotalBytes ?? MAX_TOTAL_BYTES;
  let fileSize: number;
  try {
    fileSize = statSync(filePath).size;
  } catch {
    fail(`读不到游戏包：${filePath}`);
  }
  if (fileSize > maxTotal + MAX_HEADER_BYTES + PACK_MAGIC.length + 4) fail(`包太大：${fileSize} 字节`);
  let raw: Buffer;
  try {
    raw = readFileSync(filePath);
  } catch {
    fail(`读不到游戏包：${filePath}`);
  }
  if (raw.length < PACK_MAGIC.length + 4) fail('不是游戏包：文件太短');
  if (raw.subarray(0, PACK_MAGIC.length).toString('latin1') !== PACK_MAGIC) fail('不是游戏包：魔数不对');
  const headerLength = raw.readUInt32LE(PACK_MAGIC.length);
  if (headerLength === 0 || headerLength > MAX_HEADER_BYTES) fail(`包头长度不合法：${headerLength}`);
  const headerStart = PACK_MAGIC.length + 4;
  const dataStart = headerStart + headerLength;
  if (dataStart > raw.length) fail('包头长度超过文件大小');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.subarray(headerStart, dataStart).toString('utf8'));
  } catch {
    fail('包头不是合法 JSON');
  }
  const manifest = validateManifest(parsed);
  const declaredTotal = manifest.files.reduce((sum, file) => sum + file.size, 0);
  if (declaredTotal > maxTotal) fail(`包体积超过上限：${declaredTotal} > ${maxTotal}`);

  const files: PackFile[] = [];
  let offset = dataStart;
  for (const entry of manifest.files) {
    const end = offset + entry.size;
    if (end > raw.length) fail(`文件段超出包尾：${entry.path}`);
    const bytes = raw.subarray(offset, end);
    if (sha256Hex(bytes) !== entry.sha256) fail(`文件校验失败：${entry.path}`);
    files.push({ path: entry.path, bytes });
    offset = end;
  }
  if (offset !== raw.length) fail(`包尾还有未声明的 ${raw.length - offset} 字节`);

  return { manifest, files, packageHash: sha256Hex(raw), source: filePath };
}

export function readPackSource(root: string): PackSource {
  const file = join(root, 'bpmap.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    fail(`读不到或解析不了源清单：${file}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('源清单不是对象');
  const raw = parsed as Record<string, unknown>;
  return assertSource({
    id: typeof raw.id === 'string' ? raw.id : '',
    version: typeof raw.version === 'string' ? raw.version : '',
    server: typeof raw.server === 'string' ? raw.server : '',
    ...(raw.mode !== undefined ? { mode: raw.mode as string } : {}),
    ...(raw.apiVersion !== undefined ? { apiVersion: raw.apiVersion as number } : {}),
    ...(typeof raw.client === 'string' ? { client: raw.client } : {}),
  });
}

interface CollectedSource {
  files: Array<{ path: string; bytes: Buffer }>;
  server: string;
  client?: string;
}

function collectSourceFiles(root: string, source: PackSource): CollectedSource {
  const collected = new Map<string, { path: string; bytes: Buffer }>();
  const walk = (absoluteDir: string): void => {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const absolute = join(absoluteDir, entry.name);
      const rel = relative(root, absolute).replace(/\\/g, '/');
      if (entry.isSymbolicLink()) fail(`源目录不能含符号链接：${rel}`);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (rel === 'bpmap.json' || rel === PACK_MARKER) continue;
      const path = assertPath(rel);
      const key = path.toLowerCase();
      if (collected.has(key)) fail(`源目录路径重复（Windows 不区分大小写）：${path}`);
      const bytes = readFileSync(absolute);
      if (bytes.length > MAX_FILE_BYTES) fail(`文件过大：${path}`);
      collected.set(key, { path, bytes });
    }
  };
  walk(root);

  const server = collected.get(source.server.toLowerCase());
  if (!server) fail(`服务端入口不存在：${source.server}`);
  const client = source.client ? collected.get(source.client.toLowerCase()) : undefined;
  if (source.client && !client) fail(`客户端入口不存在：${source.client}`);
  return {
    files: [...collected.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    server: server.path,
    ...(client ? { client: client.path } : {}),
  };
}

export function packDirectory(root: string, outFile: string, source: PackSource): PackManifest {
  const clean = assertSource(source);
  const collected = collectSourceFiles(root, clean);
  const entries: PackFileEntry[] = collected.files.map((file) => ({
    path: file.path,
    size: file.bytes.length,
    sha256: sha256Hex(file.bytes),
  }));
  const manifest: PackManifest = {
    format: PACK_FORMAT,
    id: clean.id,
    version: clean.version,
    mode: clean.mode ?? DEFAULT_MODE,
    apiVersion: clean.apiVersion ?? API_VERSION,
    server: collected.server,
    ...(collected.client ? { client: collected.client } : {}),
    files: entries,
  };
  const header = Buffer.from(JSON.stringify(manifest), 'utf8');
  if (header.length > MAX_HEADER_BYTES) fail('包头过大');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length, 0);
  const packed = Buffer.concat([
    Buffer.from(PACK_MAGIC, 'latin1'),
    length,
    header,
    ...collected.files.map((file) => file.bytes),
  ]);

  mkdirSync(dirname(resolve(outFile)), { recursive: true });
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
  return manifest;
}

export function listPackFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(PACK_EXTENSION))
    .map((entry) => join(root, entry.name))
    .sort();
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
  for (const entry of readdirSync(prefix ? join(dir, ...prefix.split('/')) : dir, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      files.push(path);
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...listExtracted(dir, path));
      continue;
    }
    if (entry.isFile() && path !== PACK_MARKER) files.push(path);
  }
  return files.sort();
}

function extractedMatches(dir: string, pack: LoadedPack): boolean {
  const expected = pack.manifest.files.map((entry) => entry.path).sort();
  const actual = listExtracted(dir);
  if (actual.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    if (actual[i] !== expected[i]) return false;
  }
  for (const entry of pack.manifest.files) {
    try {
      const bytes = readFileSync(join(dir, ...entry.path.split('/')));
      if (sha256Hex(bytes) !== entry.sha256) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function extractPack(pack: LoadedPack, cacheRoot: string): ExtractResult {
  const finalDir = join(cacheRoot, pack.manifest.id, pack.packageHash);
  const marker = join(finalDir, PACK_MARKER);
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
      join(tmpDir, PACK_MARKER),
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
