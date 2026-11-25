import { constants } from 'node:fs';
import { access, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

async function exists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 同目录临时文件 + fsync + rename + 备份。
 * 不保证跨文件事务；跨进程一致性由调用方的 WAL 负责。
 */
export async function atomicWriteText(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const backup = `${file}.bak`;
  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (await exists(file)) {
      await rm(backup, { force: true });
      try {
        await rename(file, backup);
      } catch (error) {
        // 另一个写入已把文件移走时，备份缺失不是错误。
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await atomicWriteText(file, JSON.stringify(value, null, 2) + '\n');
}
