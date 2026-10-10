import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { GameModule } from '@bp/server';
import { manifestOf } from '@bp/server';
import type { DiscoveryRoom } from '@bp/protocol';

/**
 * 宿主壳的静态与接口层。路由前缀就是"三方来源"的分工：
 *   /                     → 客户端页面（packages/client/public）
 *   /app/                 → 客户端编译产物（packages/client/dist，浏览器原生 ESM，无打包）
 *   /vendor/protocol/     → 协议包编译产物（给 import map 用）
 *   /games/<id>/          → 游戏模块产物（模块下发位）
 *   /api/games            → 本机装了哪些游戏
 *   /discovery/rooms      → 局域网房间列表（由本地壳代浏览器收组播）
 */

export interface WebRootOptions {
  root: string;
  modules: GameModule[];
  /** 组播浏览结果；没有本地壳时返回空表。 */
  getRooms?: () => DiscoveryRoom[];
  onBadPath?: (path: string) => void;
}
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** 解析成统一斜杠再比前缀：Windows 上 resolve 给的是反斜杠，直接比会全判成越界。 */
function asPosix(absolute: string): string {
  return resolve(absolute).replace(/\\/g, '/').replace(/\/+$/, '');
}

/** 目录穿越防线：解析后的路径必须还在声明的根里。 */
function safeJoin(root: string, relative: string): string | null {
  let decoded = relative;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  const cleaned = decoded.replace(/^[/\\]+/, '').replace(/\\/g, '/');
  const rootAbs = asPosix(root);
  const absolute = asPosix(resolve(rootAbs, cleaned));
  if (absolute !== rootAbs && !absolute.startsWith(`${rootAbs}/`)) return null;
  return absolute;
}

function sendFile(res: ServerResponse, absolute: string, cors: boolean): void {
  const type = CONTENT_TYPES[extname(absolute).toLowerCase()] ?? 'application/octet-stream';
  try {
    const body = readFileSync(absolute);
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-store',
      ...(cors ? { 'access-control-allow-origin': '*' } : {}),
    });
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end('读取失败');
  }
}

function sendJson(res: ServerResponse, data: unknown, cors = true): void {
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(cors ? { 'access-control-allow-origin': '*' } : {}),
  });
  res.end(JSON.stringify(data));
}

export function createWebServer(opts: WebRootOptions): Server {
  const publicDir = join(opts.root, 'packages', 'client', 'public');
  const clientDist = join(opts.root, 'packages', 'client', 'dist');
  const protocolDist = join(opts.root, 'packages', 'protocol', 'dist');
  const gamesDir = join(opts.root, 'games');
  // 第三方样式从 node_modules 直接挂出去：不把 635KB 产物复制进仓库，
  // 版本与 MIT 许可跟着包走，便携包本来也要带 node_modules。
  const vendorDist: Array<[string, string]> = [
    ['/vendor/tabler/', join(opts.root, 'node_modules', '@tabler', 'core', 'dist', 'css')],
    ['/vendor/tabler-icons/', join(opts.root, 'node_modules', '@tabler', 'icons-webfont', 'dist')],
  ];

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    if (path === '/api/games') {
      sendJson(res, { games: opts.modules.map((m) => manifestOf(m, m.normalizeConfig({}))) });
      return;
    }
    if (path === '/discovery/rooms') {
      sendJson(res, { rooms: opts.getRooms?.() ?? [] });
      return;
    }
    if (path === '/health') {
      sendJson(res, { ok: true, games: opts.modules.map((m) => m.id), serverNow: Date.now() });
      return;
    }

    for (const [prefix, dir] of vendorDist) {
      if (!path.startsWith(prefix)) continue;
      const absolute = safeJoin(dir, path.slice(prefix.length));
      if (!absolute || !existsSync(absolute) || !isFile(absolute)) return notFound(res, opts, path);
      return sendFile(res, absolute, false);
    }

    if (path.startsWith('/app/')) {
      const absolute = safeJoin(clientDist, path.slice('/app/'.length));
      return absolute && existsSync(absolute) ? sendFile(res, absolute, false) : notFound(res, opts, path);
    }
    if (path.startsWith('/vendor/protocol/')) {
      const absolute = safeJoin(protocolDist, path.slice('/vendor/protocol/'.length));
      return absolute && existsSync(absolute) ? sendFile(res, absolute, false) : notFound(res, opts, path);
    }
    if (path.startsWith('/games/')) {
      const relative = path.slice('/games/'.length);
      const absolute = safeJoin(gamesDir, relative);
      if (!absolute || !existsSync(absolute) || !isFile(absolute)) return notFound(res, opts, path);
      return sendFile(res, absolute, true);
    }
    if (path === '/' || path === '/index.html') {
      const index = join(publicDir, 'index.html');
      return existsSync(index) ? sendFile(res, index, false) : notFound(res, opts, path);
    }
    const asset = safeJoin(publicDir, path);
    if (asset && existsSync(asset) && isFile(asset)) return sendFile(res, asset, false);
    return notFound(res, opts, path);
  });
}

function isFile(absolute: string): boolean {
  try {
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}

function notFound(res: ServerResponse, opts: WebRootOptions, path: string): void {
  opts.onBadPath?.(path);
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('没有这个东西');
}
