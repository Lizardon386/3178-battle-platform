import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import type { DiscoveryRoom } from '@bp/protocol';

/**
 * B 档发现：同网段房间列表。不需要任何公网节点——房主发 UDP 组播信标，
 * 装了本地壳的客户端监听后聚合成列表（纯浏览器的客户端做不到，那只剩 A 档邀请链接）。
 *
 * 首次绑定通常会让 Windows 防火墙弹窗询问；那一下由用户自己点"允许"，
 * 本模块绝不代跑 netsh / 不写系统规则。
 */

export const MULTICAST_GROUP = '239.255.77.178';
export const DEFAULT_PORT = 47878;
const MAX_ROOMS_PER_BEACON = 12;

export interface BeaconPayload {
  v: 1;
  sentAt: number;
  rooms: DiscoveryRoom[];
}

export function encodeBeacon(rooms: DiscoveryRoom[], sentAt: number): Buffer {
  const trimmed = rooms
    .filter((r) => !r.hidden)
    .slice(0, MAX_ROOMS_PER_BEACON)
    .map((r) => ({ ...r, name: r.name.slice(0, 40), hostName: r.hostName.slice(0, 24) }));
  const payload: BeaconPayload = { v: 1, sentAt, rooms: trimmed };
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

export function decodeBeacon(raw: Buffer): BeaconPayload | null {
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as BeaconPayload;
    if (parsed?.v !== 1 || !Array.isArray(parsed.rooms)) return null;
    const rooms = parsed.rooms.filter((r) => typeof r?.code === 'string' && typeof r?.lanUrl === 'string');
    return { v: 1, sentAt: Number(parsed.sentAt) || 0, rooms };
  } catch {
    return null;
  }
}

export interface DiscoveryOptions {
  group?: string;
  port?: number;
  intervalMs?: number;
  /** 条目过期时间；超过就没收到信标，视为房主已退出。 */
  entryTtlMs?: number;
  now?: () => number;
}

/** 房主侧：周期广播本机房间。 */
export class LanAnnouncer {
  private socket: Socket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly group: string;
  private readonly port: number;
  private readonly intervalMs: number;
  private readonly clock: () => number;

  constructor(
    private readonly getRooms: () => DiscoveryRoom[],
    opts: DiscoveryOptions = {},
  ) {
    this.group = opts.group ?? MULTICAST_GROUP;
    this.port = opts.port ?? DEFAULT_PORT;
    this.intervalMs = opts.intervalMs ?? 2000;
    this.clock = opts.now ?? (() => Date.now());
  }

  start(): void {
    if (this.socket) return;
    const socket = createSocket('udp4');
    socket.on('error', () => this.stop());
    this.socket = socket;
    this.timer = setInterval(() => this.beat(), this.intervalMs);
    this.timer.unref?.();
  }

  private beat(): void {
    if (!this.socket) return;
    try {
      this.socket.setMulticastTTL(2);
      this.socket.setMulticastLoopback(true);
    } catch {
      // 某些网卡不接受组播设置；静默降级，A 档邀请链接仍可用。
    }
    const payload = encodeBeacon(this.getRooms(), this.clock());
    if (payload.length < 12) return;
    this.socket.send(payload, this.port, this.group, () => {});
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
  }
}

/** 客户端侧（本地壳）：监听信标并维护过期表。 */
export class LanBrowser {
  private socket: Socket | null = null;
  private readonly group: string;
  private readonly port: number;
  private readonly ttl: number;
  private readonly clock: () => number;
  private readonly seen = new Map<string, { at: number; room: DiscoveryRoom }>();

  constructor(opts: DiscoveryOptions = {}) {
    this.group = opts.group ?? MULTICAST_GROUP;
    this.port = opts.port ?? DEFAULT_PORT;
    this.ttl = opts.entryTtlMs ?? 8000;
    this.clock = opts.now ?? (() => Date.now());
  }

  start(): void {
    if (this.socket) return;
    const socket = createSocket('udp4');
    socket.on('message', (data) => this.absorb(decodeBeacon(data)));
    socket.on('error', () => this.stop());
    socket.bind(this.port, () => {
      try {
        socket.setMulticastLoopback(true);
        for (const address of multicastInterfaces()) socket.addMembership(this.group, address);
      } catch {
        // 没有可用组播接口时保持沉默：列表为空，不影响点对点加入。
      }
    });
    this.socket = socket;
  }

  /** 收到一个信标包就喂进来；本地壳也可以从别的来源（缓存文件）补投。 */
  absorb(payload: BeaconPayload | null): void {
    if (!payload) return;
    const at = this.clock();
    for (const room of payload.rooms) this.seen.set(`${room.lanUrl}#${room.code}`, { at, room });
  }

  /** 过期条目在这里被剔掉，所以调用方不需要自己算时间。 */
  list(): DiscoveryRoom[] {
    const now = this.clock();
    const out: DiscoveryRoom[] = [];
    for (const [key, entry] of this.seen) {
      if (now - entry.at > this.ttl) {
        this.seen.delete(key);
        continue;
      }
      out.push(entry.room);
    }
    return out.sort((a, b) => a.code.localeCompare(b.code));
  }

  stop(): void {
    this.socket?.close();
    this.socket = null;
    this.seen.clear();
  }
}

function multicastInterfaces(): string[] {
  const addresses: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

/** 把本机房间表转成信标条目。 */
export function toDiscoveryRoom(
  room: Pick<DiscoveryRoom, 'code' | 'name' | 'gameId' | 'gameName' | 'phase' | 'occupied' | 'seatSlots' | 'hostName' | 'hidden'>,
  lanUrl: string,
  ttl: number,
): DiscoveryRoom {
  return { ...room, lanUrl, ttl };
}
