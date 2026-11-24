import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SessionApplication } from '@bp/session-app';
import { FileSessionRepository } from '@bp/session-store';
import { SessionServer } from '@bp/session-ws';
import type { Clock, IdGenerator, Logger, SecretStore } from '@bp/session-app';

export interface ServiceOptions {
  dataDir: string;
  host?: string;
  port?: number;
}

const clock: Clock = { now: () => Date.now() };

const ids: IdGenerator = {
  next: (prefix) => `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
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
  const app = new SessionApplication(repository, clock, ids, secrets, logger);
  const server = new SessionServer({
    app,
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.port === undefined ? {} : { port: options.port }),
  });
  const { port } = await server.start();
  logger.info('session service listening', { port, dataDir: options.dataDir });
  return { port, close: () => server.close() };
}
