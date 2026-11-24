import { resolve } from 'node:path';
import { startService } from './compose.js';

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const dataDir = resolve(arg('data-dir', process.env.BP_DATA_DIR ?? resolve(process.cwd(), 'data'))!);
const port = Number(arg('port', process.env.BP_PORT ?? '0'));

startService({ dataDir, port }).then((service) => {
  console.log(`BP_SERVICE_PORT=${service.port}`);
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
