import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { SessionApplication } from '@bp/session-app';
import { FileSessionRepository } from '@bp/session-store';
import { SessionServer } from '@bp/session-ws';
import type { Clock, IdGenerator, Logger, SecretStore } from '@bp/session-app';
import type { GameRegistry } from '@bp/game-package';
import { NodeAuthoritySupervisor } from './supervisor-node.js';
import { createManagementServer } from './web.js';
import { TunnelManager, type TunnelSpawner } from '@bp/tunnel-manager';

export interface TunnelOptions {
  mode: 'quick' | 'named';
  token?: string;
  hostname?: string;
  binaryPath?: string;
  spawner?: TunnelSpawner;
}

export interface ServiceOptions {
  dataDir: string;
  host?: string;
  port?: number;
  /** 单个游戏 Authority 入口；没有注册表时作为开发回退。 */
  authorityEntry?: string;
  /** `.bpkg` 注册表；按 session 的 gameId/gameVersion 解析 Authority 与 Web。 */
  registry?: GameRegistry;
  /** 独立游戏 origin；配置注册表时默认开启（端口 0，由调用方给正式端口）。 */
  gameOrigin?: {
    host?: string;
    port?: number;
  };
  /** 管理端静态目录；默认取仓库内 packages/web-console/public。 */
  webRoot?: string;
  /** 可选公网隧道；`game` 为游戏 origin 单独一条，未配置时只监听本机/局域网。 */
  tunnel?: TunnelOptions & {
    game?: TunnelOptions;
  };
}

const clock: Clock = { now: () => Date.now() };

const ids: IdGenerator = {
  next: (prefix) => `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
  code: () => randomBytes(3).toString('hex').toUpperCase(),
};

const secrets: SecretStore = {
  issue: () => {
    const secret = randomBytes(24).toString('base64url');
    return { secret, hash: createHash('sha256').update(secret, 'utf8').digest('hex') };
  },
  hash: (secret) => createHash('sha256').update(secret, 'utf8').digest('hex'),
};

const logger: Logger = {
  info: (message, fields) => console.log(JSON.stringify({ level: 'info', message, ...fields })),
  error: (message, fields) => console.error(JSON.stringify({ level: 'error', message, ...fields })),
};

export interface RunningService {
  port: number;
  gamePort: number | null;
  /** 管理 origin 的公网地址（配置隧道时）。 */
  publicUrl: string | null;
  /** 游戏 origin 的公网地址（配置游戏隧道时）。 */
  gamePublicUrl: string | null;
  close(): Promise<void>;
}

export async function startService(options: ServiceOptions): Promise<RunningService> {
  const repository = new FileSessionRepository({ root: options.dataDir });
  let server: SessionServer;

  const handleAuthorityMessage = async (sessionId: string, message: Record<string, unknown>): Promise<void> => {
    const type = message.type;
    if (type === 'authorityReady') {
      const result = await app.markAuthorityReady(sessionId, Number(message.authorityEpoch));
      if (result.ok) server.broadcastSessionState(result.value);
      return;
    }
    if (type === 'authorityError') {
      await app.markAuthorityFailed(sessionId, Number(message.authorityEpoch), String(message.text ?? ''));
      return;
    }
    if (type === 'deliver') {
      const items = Array.isArray(message.items) ? message.items : [];
      const session = await app.getSession(sessionId);
      for (const item of items as Array<{ to?: unknown; payload?: unknown; viewSeq?: unknown }>) {
        const target = item.to;
        const meta = { viewSeq: typeof item.viewSeq === 'number' ? item.viewSeq : undefined };
        if (target === 'all') {
          for (const member of session?.members ?? []) {
            server.sendToMemberGame(sessionId, member.memberId, item.payload, meta);
          }
        } else if (typeof target === 'string') {
          server.sendToMemberGame(sessionId, target, item.payload, meta);
        }
      }
    }
  };

  const pendingAuthority = new Set<Promise<void>>();
  const supervisor = options.authorityEntry !== undefined || options.registry !== undefined
    ? new NodeAuthoritySupervisor({
      onMessage: (sessionId, message) => {
        const task = handleAuthorityMessage(sessionId, message).catch((error) => {
          logger.error('authority message failed', { sessionId, error: String(error) });
        });
        pendingAuthority.add(task);
        void task.finally(() => pendingAuthority.delete(task));
      },
      onExit: (sessionId, epoch, code) => {
        const task = app.markAuthorityFailed(sessionId, epoch, `Authority 进程退出（code=${code ?? 'null'}）`)
          .then((result) => {
            if (result.ok) server.broadcastSessionState(result.value);
          })
          .catch((error) => {
            logger.error('mark authority failed failed', { sessionId, error: String(error) });
          });
        pendingAuthority.add(task);
        void task.finally(() => pendingAuthority.delete(task));
      },
    })
    : undefined;

  const app = new SessionApplication(repository, clock, ids, secrets, logger, supervisor);
  const webRoot = options.webRoot ?? resolve(process.cwd(), 'packages/web-console/public');
  const httpServer = createManagementServer({ root: webRoot });
  let gamePublicUrl: string | null = null;
  server = new SessionServer({
    app,
    httpServer,
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.authorityEntry === undefined && options.registry === undefined ? {} : {
      authority: {
        resolveEntry: (session) => {
          const registered = options.registry?.resolve(session.gameId, session.gameVersion);
          if (registered) return { entry: registered.authorityEntry, runtime: registered.runtime };
          return options.authorityEntry === undefined ? null : { entry: options.authorityEntry };
        },
        stateRoot: join(options.dataDir, 'authority'),
      },
      onGameFrame: (sessionId: string, memberId: string, payload: unknown) => {
        void app.routeGame(sessionId, memberId, payload);
      },
    }),
    ...(options.registry === undefined ? {} : {
      gameOrigin: {
        ...(options.gameOrigin?.host === undefined ? {} : { host: options.gameOrigin.host }),
        port: options.gameOrigin?.port ?? 0,
        resolveRoot: (session) => options.registry!.resolve(session.gameId, session.gameVersion)?.web ?? null,
        publicUrl: () => gamePublicUrl,
      },
      gameRegistry: options.registry,
    }),
  });

  const { port, gamePort } = await server.start();
  logger.info('session service listening', { port, gamePort, dataDir: options.dataDir });

  let publicUrl: string | null = null;
  let tunnels: TunnelManager | null = null;
  if (options.tunnel) {
    const gameTunnel = options.tunnel.game;
    tunnels = new TunnelManager({
      binaryPath: options.tunnel.binaryPath ?? gameTunnel?.binaryPath ?? process.env.BP_CLOUDFLARED ?? 'cloudflared',
      ...(options.tunnel.spawner === undefined
        ? (gameTunnel?.spawner === undefined ? {} : { spawner: gameTunnel.spawner })
        : { spawner: options.tunnel.spawner }),
    });
    tunnels.register('management', {
      mode: options.tunnel.mode,
      localPort: port,
      ...(options.tunnel.token === undefined ? {} : { token: options.tunnel.token }),
      ...(options.tunnel.hostname === undefined ? {} : { hostname: options.tunnel.hostname }),
    });
    const gameTunnelReady = gameTunnel !== undefined && gamePort !== null;
    if (gameTunnel && gamePort === null) {
      logger.error('game tunnel requires game origin', { hint: '配置 registry 后才会监听游戏 origin' });
    }
    if (gameTunnelReady) {
      tunnels.register('game', {
        mode: gameTunnel.mode,
        localPort: gamePort,
        ...(gameTunnel.token === undefined ? {} : { token: gameTunnel.token }),
        ...(gameTunnel.hostname === undefined ? {} : { hostname: gameTunnel.hostname }),
      });
    }
    try {
      const status = await tunnels.start('management');
      publicUrl = status.publicUrl;
      logger.info('tunnel ready', { name: 'management', url: publicUrl });
    } catch (error) {
      logger.error('tunnel failed', { name: 'management', error: String(error) });
    }
    if (gameTunnelReady) {
      try {
        const status = await tunnels.start('game');
        gamePublicUrl = status.publicUrl;
        logger.info('tunnel ready', { name: 'game', url: gamePublicUrl });
      } catch (error) {
        logger.error('tunnel failed', { name: 'game', error: String(error) });
      }
    }
  }

  return {
    port,
    gamePort,
    publicUrl,
    gamePublicUrl,
    close: async () => {
      await tunnels?.stopAll();
      await supervisor?.stopAll();
      await Promise.all([...pendingAuthority]);
      await server.close();
    },
  };
}
