import { roomCode } from './ids.js';
import type { Room, RoomSpec } from './room.js';
import { Room as RoomImpl } from './room.js';

/** 房主机上的房间表。跨网的房间列表不在这里——那需要一个公共节点，本方案刻意不做。 */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly clock: () => number;

  constructor(clock?: () => number) {
    this.clock = clock ?? (() => Date.now());
  }

  create(spec: Omit<RoomSpec, 'code' | 'now'> & { code?: string }): Room {
    const code = spec.code ?? roomCode((candidate) => this.rooms.has(candidate));
    if (this.rooms.has(code)) throw new Error(`房号 ${code} 已存在`);
    const room = new RoomImpl({ ...spec, code, now: this.clock() }, this.clock);
    this.rooms.set(code, room);
    return room;
  }

  attach(room: Room): void {
    this.rooms.set(room.code, room);
  }

  get(code: string | undefined): Room | undefined {
    if (!code) return undefined;
    return this.rooms.get(code.trim().toUpperCase());
  }

  remove(code: string): boolean {
    return this.rooms.delete(code.toUpperCase());
  }

  /** 隐藏房不上局域网信标，但房主自己列房时仍要能看见。 */
  list(includeHidden = false): Room[] {
    const all = [...this.rooms.values()];
    return includeHidden ? all : all.filter((r) => !r.hidden);
  }

  size(): number {
    return this.rooms.size;
  }
}
