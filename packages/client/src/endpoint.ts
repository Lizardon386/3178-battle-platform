/**
 * 房主地址解析：玩家手里只有一条"地址 + 房号"，要变成能连的 ws URL。
 * 这是旧项目 `location.host` 写死的替代位——纯函数，能在 node 里测。
 */

export interface Endpoint {
  /** 给 WebSocket 用：ws://host:port/ws 或 wss://host/ws */
  wsUrl: string;
  /** 给静态资源与 /api 用：http://host:port 或 https://host */
  httpOrigin: string;
  host: string;
  port: number | null;
  secure: boolean;
}

export type EndpointError = 'EMPTY' | 'BAD_SCHEME' | 'BAD_HOST' | 'NO_PORT_HINT';

export type EndpointResult = { ok: true; endpoint: Endpoint } | { ok: false; code: EndpointError; message: string };

function bad(code: EndpointError, message: string): EndpointResult {
  return { ok: false, code, message };
}

function build(scheme: 'http' | 'https' | 'ws' | 'wss', hostPort: string, path = '/ws'): EndpointResult {
  if (!hostPort) return bad('BAD_HOST', '地址里缺主机名');
  const secure = scheme === 'https' || scheme === 'wss';
  const colon = hostPort.lastIndexOf(':');
  let host = hostPort;
  let port: number | null = null;
  if (colon > 0 && /^\d+$/.test(hostPort.slice(colon + 1))) {
    host = hostPort.slice(0, colon);
    port = Number(hostPort.slice(colon + 1));
  }
  if (!host) return bad('BAD_HOST', '地址里缺主机名');
  const wsScheme = secure ? 'wss' : 'ws';
  const httpScheme = secure ? 'https' : 'http';
  const hostPart = port === null ? host : `${host}:${port}`;
  return {
    ok: true,
    endpoint: {
      wsUrl: `${wsScheme}://${hostPart}${path}`,
      httpOrigin: `${httpScheme}://${hostPart}`,
      host,
      port,
      secure,
    },
  };
}

/** 接受 `192.168.1.20:3000`、`http://…`、`ws://…`、`https://xxx.trycloudflare.com`。 */
export function parseHostAddress(input: string): EndpointResult {
  const raw = (input ?? '').trim();
  if (!raw) return bad('EMPTY', '请先填房主地址');
  const schemeMatch = /^(https?|wss?):\/\/(.*)$/i.exec(raw);
  if (!schemeMatch && /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return bad('BAD_SCHEME', '只支持 http / https / ws / wss');
  const rest = schemeMatch?.[2] ?? raw;
  const hostPort = (rest.split('/')[0] ?? '').split(/[?#]/)[0] ?? '';
  const scheme = (schemeMatch?.[1] ?? 'http').toLowerCase() as 'http' | 'https' | 'ws' | 'wss';
  return build(scheme, hostPort);
}

/**
 * 邀请链接：`http://房主地址/?h=房主地址&r=房号&g=游戏id`。
 * `h` 缺省就用链接自己的来源（房主直发的链接最常见的情形）。
 */
export function parseInviteLink(url: string, selfOrigin?: string): { endpoint: Endpoint | null; code: string | null; gameId: string | null } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { endpoint: null, code: null, gameId: null };
  }
  const code = (parsed.searchParams.get('r') ?? '').trim().toUpperCase() || null;
  const gameId = (parsed.searchParams.get('g') ?? '').trim() || null;
  const hostParam = (parsed.searchParams.get('h') ?? '').trim();
  if (hostParam) {
    const result = parseHostAddress(hostParam);
    if (result.ok) {
      return {
        endpoint: {
          ...result.endpoint,
          wsUrl: withPath(result.endpoint.wsUrl, parsed.searchParams.get('p') ?? '/ws'),
        },
        code,
        gameId,
      };
    }
  }
  const origin = selfOrigin ?? `${parsed.protocol}//${parsed.host}`;
  const fallback = parseHostAddress(origin);
  return { endpoint: fallback.ok ? fallback.endpoint : null, code, gameId };
}

function withPath(wsUrl: string, path: string): string {
  const match = /^(wss?:\/\/[^/]+)(\/.*)?$/.exec(wsUrl);
  if (!match) return wsUrl;
  return `${match[1]}${path}`;
}

/** 混合内容提醒：https 页面连 ws 会被浏览器拦，这条规则要给用户讲明白。 */
export function wouldBeBlocked(pageProtocol: string, endpoint: Endpoint): boolean {
  return pageProtocol === 'https:' && !endpoint.secure;
}
