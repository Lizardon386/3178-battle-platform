import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { API_VERSION, DEFAULT_MODE } from '@bp/core-abi';
import { PACK_FORMAT, readPack, readPackSource } from '../node/pack.js';

export interface HostInfo {
  platform?: string;
  packFormats?: unknown;
  protocolVersions?: unknown;
  apiVersions?: unknown;
  modes?: Record<string, unknown>;
  clientCaps?: unknown;
}

export interface DoctorTarget {
  kind: 'source' | 'pack';
  path: string;
  id: string;
  version: string;
  server: string;
  client?: string;
  format: number;
  mode: string;
  apiVersion: number;
}

export interface DoctorCheck {
  ok: boolean;
  label: string;
  detail?: string;
}

export interface DoctorReport {
  target: DoctorTarget;
  checks: DoctorCheck[];
}

function readSourceTarget(dir: string): DoctorTarget {
  const rawPath = join(dir, 'bpmap.json');
  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(rawPath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('不是对象');
    raw = parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`读不到或解析不了源清单：${rawPath}（${error instanceof Error ? error.message : String(error)}）`);
  }
  const source = readPackSource(dir);
  return {
    kind: 'source',
    path: dir,
    id: source.id,
    version: source.version,
    server: source.server,
    ...(source.client ? { client: source.client } : {}),
    format: PACK_FORMAT,
    mode: typeof raw.mode === 'string' && raw.mode ? raw.mode : DEFAULT_MODE,
    apiVersion: typeof raw.apiVersion === 'number' && Number.isSafeInteger(raw.apiVersion) && raw.apiVersion > 0
      ? raw.apiVersion
      : API_VERSION,
  };
}

function readPackTarget(file: string): DoctorTarget {
  const pack = readPack(file);
  return {
    kind: 'pack',
    path: file,
    id: pack.manifest.id,
    version: pack.manifest.version,
    server: pack.manifest.server,
    ...(pack.manifest.client ? { client: pack.manifest.client } : {}),
    format: pack.manifest.format,
    mode: pack.manifest.mode,
    apiVersion: pack.manifest.apiVersion,
  };
}

export function readDoctorTarget(target: string): DoctorTarget {
  const absolute = resolve(target);
  if (!existsSync(absolute)) throw new Error(`目标不存在：${absolute}`);
  return statSync(absolute).isDirectory() ? readSourceTarget(absolute) : readPackTarget(absolute);
}

function includesVersion(value: unknown, wanted: number): boolean {
  return Array.isArray(value) && value.some((item) => item === wanted);
}

function modeSupported(value: unknown, wanted: number): boolean {
  return Array.isArray(value) && value.some((item) => item === wanted);
}

export function checkHost(target: DoctorTarget, host: HostInfo): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  checks.push({
    ok: includesVersion(host.packFormats, target.format),
    label: `包格式 ${target.format}`,
    detail: Array.isArray(host.packFormats) ? `宿主支持 ${host.packFormats.join('、')}` : '宿主要求没有返回 packFormats',
  });
  checks.push({
    ok: includesVersion(host.apiVersions, target.apiVersion),
    label: `apiVersion ${target.apiVersion}`,
    detail: Array.isArray(host.apiVersions) ? `宿主支持 ${host.apiVersions.join('、')}` : '宿主要求没有返回 apiVersions',
  });
  const modes = host.modes && typeof host.modes === 'object' ? host.modes : {};
  const profile = (modes as Record<string, unknown>)[target.mode];
  checks.push({
    ok: modeSupported(profile, 1),
    label: `模式 ${target.mode}`,
    detail: profile === undefined ? `宿主没有声明 ${target.mode}` : `宿主支持 ${target.mode} 的 profile ${Array.isArray(profile) ? profile.join('、') : '（格式不对）'}`,
  });
  return checks;
}

export async function fetchHostInfo(host: string): Promise<HostInfo> {
  const url = `${host.replace(/\/+$/, '')}/api/version`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    throw new Error(`连不上宿主 ${url}：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`宿主 ${url} 返回 ${response.status}`);
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new Error(`宿主 ${url} 返回的不是 JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`宿主 ${url} 返回格式不对`);
  return parsed as HostInfo;
}

export function localChecks(target: DoctorTarget): DoctorCheck[] {
  if (target.kind === 'source') {
    const dir = target.path;
    const checks: DoctorCheck[] = [
      { ok: existsSync(join(dir, target.server)), label: `服务端入口 ${target.server}` },
    ];
    if (target.client) checks.push({ ok: existsSync(join(dir, target.client)), label: `客户端入口 ${target.client}` });
    return checks;
  }
  return [
    { ok: target.format === PACK_FORMAT, label: `包格式 ${target.format}` },
    { ok: Boolean(target.server), label: `服务端入口 ${target.server}` },
  ];
}

export async function doctor(target: string, hostUrl?: string): Promise<DoctorReport> {
  const info = readDoctorTarget(target);
  const checks = localChecks(info);
  if (hostUrl) {
    const host = await fetchHostInfo(hostUrl);
    checks.push(...checkHost(info, host));
  }
  return { target: info, checks };
}
