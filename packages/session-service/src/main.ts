import { resolve } from 'node:path';
import { openGameRegistry } from '@bp/game-package';
import { startService } from './compose.js';

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const dataDir = resolve(arg('data-dir', process.env.BP_DATA_DIR ?? resolve(process.cwd(), 'data'))!);
const port = Number(arg('port', process.env.BP_PORT ?? '0'));
const authorityEntry = arg('authority-entry', process.env.BP_AUTHORITY_ENTRY);
const gamesDir = arg('games-dir', process.env.BP_GAMES_DIR);
const packageFile = arg('package', process.env.BP_PACKAGE);
const gamePort = Number(arg('game-port', process.env.BP_GAME_PORT ?? '3001'));
const gameHost = arg('game-host', process.env.BP_GAME_HOST);
const tunnelMode = arg('tunnel', process.env.BP_TUNNEL);
const tunnelToken = arg('tunnel-token', process.env.BP_TUNNEL_TOKEN);
const tunnelHostname = arg('tunnel-hostname', process.env.BP_TUNNEL_HOSTNAME);
const cloudflared = arg('cloudflared', process.env.BP_CLOUDFLARED);

const registry = gamesDir === undefined && packageFile === undefined
  ? undefined
  : openGameRegistry({
    ...(gamesDir === undefined ? {} : { directories: [resolve(gamesDir)] }),
    ...(packageFile === undefined ? {} : { packages: [resolve(packageFile)] }),
    cacheRoot: resolve(dataDir, 'packages'),
  });

startService({
  dataDir,
  port,
  ...(authorityEntry === undefined ? {} : { authorityEntry: resolve(authorityEntry) }),
  ...(registry === undefined ? {} : {
    registry,
    gameOrigin: {
      ...(gameHost === undefined ? {} : { host: gameHost }),
      port: gamePort,
    },
  }),
  ...(tunnelMode === 'quick' || tunnelMode === 'named' ? {
    tunnel: {
      mode: tunnelMode,
      ...(tunnelToken === undefined ? {} : { token: tunnelToken }),
      ...(tunnelHostname === undefined ? {} : { hostname: tunnelHostname }),
      ...(cloudflared === undefined ? {} : { binaryPath: resolve(cloudflared) }),
    },
  } : {}),
}).then((service) => {
  console.log(`BP_SERVICE_PORT=${service.port}`);
  if (service.gamePort !== null) console.log(`BP_GAME_PORT=${service.gamePort}`);
  if (service.publicUrl) console.log(`BP_PUBLIC_URL=${service.publicUrl}`);
  const stop = async () => {
    await service.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
