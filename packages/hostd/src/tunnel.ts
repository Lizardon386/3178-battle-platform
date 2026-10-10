import { spawn, execFileSync, type ChildProcess } from 'node:child_process';

/**
 * cloudflared 隧道：跨网联机用。二进制**不随包走**，只找 PATH 上现装的
 * （它由 Cloudflare 签名，比我们自己编的 exe 更容易过本机 Smart App Control）。
 * 找不到就退回明文 http，让局域网玩法照常可用——不静默下载安装物。
 */

export interface TunnelResult {
  url: string | null;
  pid: number | null;
  localUrl: string;
  note: string;
}

const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** 优先用显式指定，其次查 PATH。查不到就null，绝不现场下载。 */
export function findCloudflared(platform: NodeJS.Platform = process.platform): string | null {
  const override = process.env.BP_CLOUDFLARED;
  if (override) return override;
  const finder = platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(finder, ['cloudflared'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = out.split(/\r?\n/)[0]?.trim();
    return first || null;
  } catch {
    return null;
  }
}

export function startTunnel(port: number, log: (line: string) => void): Promise<TunnelResult> {
  const localUrl = `http://localhost:${port}`;
  const binary = findCloudflared();
  if (!binary) {
    return Promise.resolve({
      url: null,
      pid: null,
      localUrl,
      note: '没找到 cloudflared（可用环境变量 CLOUDFLARED 指定路径）。跨网联机需要它，本机局域网仍然可以玩。',
    });
  }
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(binary, ['tunnel', '--url', localUrl], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ url: null, pid: null, localUrl, note: `cloudflared 启动失败：${String(error)}` });
      return;
    }
    let settled = false;
    const finish = (result: TunnelResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ url: null, pid: child.pid ?? null, localUrl, note: '等了 20 秒没拿到隧道网址，先用本地地址。' }),
      20_000,
    );
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString();
      log(text.trim().replace(/\s+/g, ' ').slice(0, 160));
      const match = TUNNEL_URL.exec(text);
      if (match) finish({ url: match[0], pid: child.pid ?? null, localUrl, note: '隧道已建立' });
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('close', (code) => {
      if (!settled) finish({ url: null, pid: null, localUrl, note: `cloudflared 退出（${code}），只用本地地址。` });
    });
    child.on('error', (error) => finish({ url: null, pid: null, localUrl, note: `cloudflared 不可用：${String(error)}` }));
  });
}

export function stopTunnel(child: ChildProcess | null): void {
  try {
    child?.kill();
  } catch {
    // 已经退了
  }
}
