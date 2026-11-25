import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openGameRegistry } from '@bp/game-package';
import { startService, type TunnelOptions } from './compose.js';

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
const gameTunnelMode = arg('game-tunnel', process.env.BP_GAME_TUNNEL);
const gameTunnelToken = arg('game-tunnel-token', process.env.BP_GAME_TUNNEL_TOKEN);
const gameTunnelHostname = arg('game-tunnel-hostname', process.env.BP_GAME_TUNNEL_HOSTNAME);
const gameCloudflared = arg('game-cloudflared', process.env.BP_GAME_CLOUDFLARED);
const trustedKeyFile = arg('trusted-key', process.env.BP_TRUSTED_KEY);
const requireSignatures = process.argv.includes('--require-signatures')
  || process.env.BP_REQUIRE_SIGNATURES === '1'
  || trustedKeyFile !== undefined;
const trustedKeys = trustedKeyFile === undefined
  ? []
  : [readFileSync(resolve(trustedKeyFile), 'utf8')];
if (requireSignatures && trustedKeys.length === 0) {
  console.error('已要求游戏包签名，但缺少 --trusted-key <公钥 PEM>');
  process.exit(1);
}

const gameTunnel: TunnelOptions | undefined = gameTunnelMode === 'quick' || gameTunnelMode === 'named'
  ? {
    mode: gameTunnelMode,
    ...(gameTunnelToken === undefined ? {} : { token: gameTunnelToken }),
    ...(gameTunnelHostname === undefined ? {} : { hostname: gameTunnelHostname }),
    ...(gameCloudflared === undefined ? {} : { binaryPath: resolve(gameCloudflared) }),
  }
  : undefined;

const registry = gamesDir === undefined && packageFile === undefined
  ? undefined
  : openGameRegistry({
    ...(gamesDir === undefined ? {} : { directories: [resolve(gamesDir)] }),
    ...(packageFile === undefined ? {} : { packages: [resolve(packageFile)] }),
    cacheRoot: resolve(dataDir, 'packages'),
    ...(requireSignatures ? { trust: { requireSignature: true, trustedKeys } } : {}),
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
      ...(gameTunnel === undefined ? {} : { game: gameTunnel }),
    },
  } : {}),
}).then((service) => {
  console.log(`BP_SERVICE_PORT=${service.port}`);
  if (service.gamePort !== null) console.log(`BP_GAME_PORT=${service.gamePort}`);
  if (service.publicUrl) console.log(`BP_PUBLIC_URL=${service.publicUrl}`);
  if (service.gamePublicUrl) console.log(`BP_GAME_PUBLIC_URL=${service.gamePublicUrl}`);
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
