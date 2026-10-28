import { Engine, type TtlConfig } from '@bp/server';
import type { GameModule } from '@3178/game-sdk';

/** 契约测试台：开引擎、开连接、建房、推进时钟；测试文件只写断言。 */

export class Recorder {
  sent: any[] = [];
  closedCode: number | null = null;

  send(raw: string): void {
    this.sent.push(JSON.parse(raw));
  }

  close(code?: number): void {
    this.closedCode = code ?? 1000;
  }

  of(type: string): any[] {
    return this.sent.filter((message) => message.type === type);
  }

  last(type: string): any {
    const list = this.of(type);
    return list[list.length - 1];
  }

  clear(): void {
    this.sent.length = 0;
  }
}

export interface HarnessSpec {
  module: GameModule;
  random?: () => number;
  ttl?: Partial<TtlConfig>;
  ratePerSec?: number;
  burst?: number;
  config?: Record<string, unknown>;
  roomName?: string;
  seatSlots?: number;
  rulesHash?: string;
}

export function harness(spec: HarnessSpec) {
  let now = 10_000;
  let tick = 0;
  const engine = new Engine({
    modules: [spec.module],
    now: () => now,
    random: spec.random ?? (() => (tick = (tick + 0.37) % 1)),
    ttl: spec.ttl,
    ratePerSec: spec.ratePerSec ?? 1000,
    burst: spec.burst ?? 1000,
  });
  const join = (nick: string, extra: { version?: string; rulesHash?: string } = {}) => {
    const rec = new Recorder();
    const connId = engine.openConn(rec);
    engine.publish(engine.dispatch(connId, {
      type: 'hello',
      protocol: 1,
      nick,
      gameId: spec.module.id,
      version: extra.version ?? spec.module.version,
      rulesHash: extra.rulesHash ?? spec.rulesHash,
    }));
    return {
      rec,
      connId,
      send: (msg: any) => {
        const out = engine.dispatch(connId, msg);
        engine.publish(out);
        return out;
      },
    };
  };
  const step = (ms: number): void => {
    now += ms;
    engine.publish(engine.tick());
  };
  return { engine, now: () => now, join, step, setNow: (value: number) => (now = value) };
}

export type Harness = ReturnType<typeof harness>;
export type HarnessHost = ReturnType<Harness['join']>;

export function createRoom(h: Harness, spec: HarnessSpec, overrides: Record<string, unknown> = {}): HarnessHost {
  const host = h.join('房主');
  host.send({
    type: 'roomCreate',
    gameId: spec.module.id,
    roomName: spec.roomName ?? '测试房',
    seatSlots: spec.seatSlots ?? 3,
    config: spec.config,
    allowSpectate: true,
    ...overrides,
  });
  return host;
}
