import { spawn } from 'node:child_process';
import type { TunnelConfig, TunnelProcess, TunnelSpawner } from './types.js';

const PROXY_ENV = /^(?:https?_proxy|all_proxy|no_proxy)$/i;
const CLOUDFLARE_ENV = /^(?:TUNNEL_|CLOUDFLARED_|NO_AUTOUPDATE$)/i;

/** 子进程只看到临时 HOME 与必要的 cloudflared 变量，不继承用户全局配置或代理。 */
export function tunnelEnvironment(source: NodeJS.ProcessEnv, tempDir: string, token?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (!PROXY_ENV.test(key) && !CLOUDFLARE_ENV.test(key)) env[key] = value;
  }
  env.HOME = tempDir;
  env.USERPROFILE = tempDir;
  env.XDG_CONFIG_HOME = tempDir;
  env.NO_AUTOUPDATE = 'true';
  if (token) env.TUNNEL_TOKEN = token;
  return env;
}

export function cloudflaredArgs(config: TunnelConfig): string[] {
  if (config.mode === 'quick') {
    return ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${config.localPort}`];
  }
  return ['tunnel', '--no-autoupdate', 'run'];
}

export const nodeSpawner: TunnelSpawner = {
  start(config, binaryPath, env): TunnelProcess {
    const child = spawn(binaryPath, cloudflaredArgs(config), {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return {
      ...(child.pid === undefined ? {} : { pid: child.pid }),
      stdout: child.stdout!,
      stderr: child.stderr!,
      onExit: (listener) => child.on('exit', listener),
      kill: (signal) => child.kill(signal),
    };
  },
};
