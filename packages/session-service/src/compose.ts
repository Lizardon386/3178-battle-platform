import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { SessionApplication } from '@bp/session-app';
import { FileSessionRepository } from '@bp/session-store';
import { SessionServer } from '@bp/session-ws';
import type { Clock, IdGenerator, Logger, SecretStore } from '@bp/session-app';
import { NodeAuthoritySupervisor } from './supervisor-node.js';
import { createManagementServer } from './web.js';

export interface ServiceOptions {
  dataDir: string;
  host?: string;
  port?: number;
  /** 单个游戏 Authority 入口；没有时只提供会话能力，startGame 会失败。 */
  authorityEntry?: string;
  /** 管理端静态目录；默认取仓库内 packages/web-console/public。 */
  webRoot?: string;
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
  const supervisor = options.authorityEntry
    ? new NodeAuthoritySupervisor({
      onMessage: (sessionId, message) => {
        const task = handleAuthorityMessage(sessionId, message).catch((error) => {
          logger.error('authority message failed', { sessionId, error: String(error) });
        });
        pendingAuthority.add(task);
        void task.finally(() => pendingAuthority.delete(task));
      },
    })
    : undefined;

  const app = new SessionApplication(repository, clock, ids, secrets, logger, supervisor);
  const webRoot = options.webRoot ?? resolve(process.cwd(), 'packages/web-console/public');
  const httpServer = createManagementServer({ root: webRoot });
  server = new SessionServer({
    app,
    httpServer,
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.authorityEntry === undefined ? {} : {
      authority: {
        resolveEntry: () => ({ entry: options.authorityEntry! }),
        stateRoot: join(options.dataDir, 'authority'),
      },
      onGameFrame: (sessionId: string, memberId: string, payload: unknown) => {
        void app.routeGame(sessionId, memberId, payload);
      },
    }),
  });

  const { port } = await server.start();
  logger.info('session service listening', { port, dataDir: options.dataDir });

  return {
    port,
    close: async () => {
      await supervisor?.stopAll();
      await Promise.all([...pendingAuthority]);
      await server.close();
    },
  };
}
