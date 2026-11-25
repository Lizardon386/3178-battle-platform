import { createServer, type Server } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export const MANAGEMENT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function safeJoin(root: string, pathname: string): string | null {
  const rootAbs = resolve(root);
  const target = resolve(join(rootAbs, pathname.replace(/^\/+/, '')));
  if (target !== rootAbs && !target.startsWith(`${rootAbs}/`) && !target.startsWith(`${rootAbs}\\`)) return null;
  return target;
}

/** 管理 origin 的静态页：只服务 web-console，带严格 CSP，不做游戏静态分发。 */
export function createManagementServer(options: { root: string }): Server {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    const file = safeJoin(options.root, pathname === '/' ? '/index.html' : pathname);
    if (!file) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
      const body = readFileSync(file);
      response.writeHead(200, {
        'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-security-policy': MANAGEMENT_CSP,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
}
