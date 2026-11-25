import { CloudflareTunnel } from './cloudflare.js';
import type { TunnelConfig, TunnelSpawner, TunnelStatus } from './types.js';

export interface TunnelManagerOptions {
  binaryPath: string;
  spawner?: TunnelSpawner;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  namedReadyDelayMs?: number;
}

/** 按名字管理多条隧道；管理 origin 与游戏 origin 各一条，互不影响。 */
export class TunnelManager {
  private readonly tunnels = new Map<string, CloudflareTunnel>();
  private readonly listeners = new Set<(status: TunnelStatus) => void>();

  constructor(private readonly options: TunnelManagerOptions) {}

  register(name: string, config: TunnelConfig): void {
    if (this.tunnels.has(name)) throw new Error(`隧道已存在：${name}`);
    const tunnel = new CloudflareTunnel({
      ...config,
      name,
      binaryPath: this.options.binaryPath,
      ...(this.options.spawner === undefined ? {} : { spawner: this.options.spawner }),
      ...(this.options.startTimeoutMs === undefined ? {} : { startTimeoutMs: this.options.startTimeoutMs }),
      ...(this.options.stopTimeoutMs === undefined ? {} : { stopTimeoutMs: this.options.stopTimeoutMs }),
      ...(this.options.namedReadyDelayMs === undefined ? {} : { namedReadyDelayMs: this.options.namedReadyDelayMs }),
    });
    tunnel.onChange((status) => {
      for (const listener of this.listeners) listener(status);
    });
    this.tunnels.set(name, tunnel);
  }

  start(name: string): Promise<TunnelStatus> {
    return this.require(name).start();
  }

  async stop(name: string): Promise<void> {
    await this.require(name).stop();
  }

  status(name: string): TunnelStatus {
    return this.require(name).getStatus();
  }

  statusAll(): TunnelStatus[] {
    return [...this.tunnels.values()].map((tunnel) => tunnel.getStatus());
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.tunnels.values()].map((tunnel) => tunnel.stop()));
  }

  onChange(listener: (status: TunnelStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private require(name: string): CloudflareTunnel {
    const tunnel = this.tunnels.get(name);
    if (!tunnel) throw new Error(`未知隧道：${name}`);
    return tunnel;
  }
}
