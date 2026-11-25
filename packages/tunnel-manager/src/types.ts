export type TunnelMode = 'quick' | 'named';

export type TunnelPhase = 'stopped' | 'starting' | 'registering' | 'ready' | 'failed';

export type TunnelErrorCode = 'configuration' | 'token' | 'runtime' | 'network' | 'timeout' | 'route';

export interface TunnelConfig {
  mode: TunnelMode;
  localPort: number;
  /** named 模式必填；只经环境变量传给子进程，不进命令行。 */
  token?: string;
  /** named 模式的固定 hostname；quick 模式忽略。 */
  hostname?: string;
}

export interface TunnelStatus {
  name: string;
  mode: TunnelMode;
  phase: TunnelPhase;
  localPort: number;
  publicUrl: string | null;
  pid?: number;
  errorCode?: TunnelErrorCode;
  errorText?: string;
  startedAt?: number;
  updatedAt: number;
}

export interface TunnelProcess {
  pid?: number;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  kill(signal?: NodeJS.Signals): void;
}

export interface TunnelSpawner {
  start(config: TunnelConfig, binaryPath: string, env: NodeJS.ProcessEnv): TunnelProcess;
}
