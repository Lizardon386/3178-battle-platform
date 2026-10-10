/**
 * 服务端时间轴：倒计时一律用"服务端下发的相对毫秒 + 本地单调钟"外推。
 * 旧客户端拿本地 Date.now() 去比服务端的绝对时间戳，两台机器时钟不齐时倒计时直接失真。
 */

export interface ClockSource {
  /** 单调递增毫秒；浏览器用 performance.now()。 */
  monotonic(): number;
}

export class ServerClock {
  private anchorServerNow = 0;
  private anchorMonotonic = 0;
  private synced = false;
  private pingSentAt: number | null = null;
  rttMs = 0;

  constructor(private readonly source: ClockSource = { monotonic: () => Date.now() }) {}

  /** 任何带 serverNow 的帧都能校准。 */
  sync(serverNow: number): void {
    this.anchorServerNow = serverNow;
    this.anchorMonotonic = this.source.monotonic();
    this.synced = true;
  }

  markPingSent(): void {
    this.pingSentAt = this.source.monotonic();
  }

  /** pong 里的 serverNow 是服务端处理时刻，再加半个 RTT 才是"现在"。 */
  onPong(serverNow: number): void {
    if (this.pingSentAt !== null) {
      this.rttMs = Math.max(0, this.source.monotonic() - this.pingSentAt);
      this.pingSentAt = null;
    }
    this.sync(serverNow + Math.round(this.rttMs / 2));
  }

  now(): number {
    if (!this.synced) return this.source.monotonic();
    return this.anchorServerNow + (this.source.monotonic() - this.anchorMonotonic);
  }

  isSynced(): boolean {
    return this.synced;
  }
}
