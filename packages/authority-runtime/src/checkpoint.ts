import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalJson } from '@bp/protocol-contract';

export interface CheckpointFile {
  version: 1;
  sessionId: string;
  roundId: string;
  epoch: number;
  gameSequence: number;
  viewSeqByMember: Record<string, number>;
  stateHash: string;
  state: unknown;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function checkpointPath(stateDir: string): string {
  return join(stateDir, 'checkpoint.json');
}

export async function writeCheckpoint(stateDir: string, data: Omit<CheckpointFile, 'stateHash'>): Promise<CheckpointFile> {
  const stateHash = createHash('sha256').update(canonicalJson(data.state), 'utf8').digest('hex');
  const file: CheckpointFile = { ...data, stateHash };
  await mkdir(dirname(checkpointPath(stateDir)), { recursive: true });
  const target = checkpointPath(stateDir);
  const tmp = `${target}.tmp`;
  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(JSON.stringify(file), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (await exists(target)) {
    await rm(`${target}.bak`, { force: true });
    await rename(target, `${target}.bak`);
  }
  await rename(tmp, target);
  return file;
}

export async function readCheckpoint(stateDir: string): Promise<CheckpointFile | null> {
  try {
    const raw = await readFile(checkpointPath(stateDir), 'utf8');
    const file = JSON.parse(raw) as CheckpointFile;
    if (file.version !== 1) return null;
    const hash = createHash('sha256').update(canonicalJson(file.state), 'utf8').digest('hex');
    return hash === file.stateHash ? file : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}
