import type { GameManifest, GameUiOptions, NoticeCode, PlatformCode, RoomPhase, SeatRole } from '@bp/protocol';

/**
 * 平台与游戏模块之间的唯一契约。
 * 三条硬规矩：
 *  1. 游戏状态不进平台对象——平台只搬 opaque blob。
 *  2. 游戏不许直接碰 socket——一切对外投递都通过返回 Effect[]。
 *  3. 游戏不许改房间相位、座位表或房主权限——那要经过平台（Ready 闸、TTL、审计都在平台）。
 */

export type ViewerId = string | null;

export type Effect =
  | { kind: 'broadcast'; name: string; payload?: unknown }
  | { kind: 'toSeat'; seatId: string; name: string; payload?: unknown }
  | { kind: 'notice'; code: NoticeCode; text?: string }
  | { kind: 'system'; text: string }
  | { kind: 'end'; reason?: string }
  | { kind: 'kick'; seatId: string; reason?: string };

export interface Reject {
  reject: string;
  code?: PlatformCode;
}

export type Outcome = Effect[] | Reject;

export function isReject(value: Outcome): value is Reject {
  return !Array.isArray(value) && typeof (value as Reject)?.reject === 'string';
}

export function reject(message: string, code?: PlatformCode): Reject {
  return code ? { reject: message, code } : { reject: message };
}

export interface GameAction {
  name: string;
  payload?: unknown;
}

/** 传给游戏模块的座位信息：不含 socket、不含票据，游戏拿不到传输细节。 */
export interface GameSeatInfo {
  seatId: string;
  slot: number;
  name: string;
  role: SeatRole;
  team: string | number | null;
  ready: boolean;
  connected: boolean;
}

export interface GameContext {
  readonly roomCode: string;
  readonly config: Record<string, unknown>;
  /** 注入时钟与随机源，让规则测试可确定性推进。 */
  now(): number;
  random(): number;
  seats(): GameSeatInfo[];
  seat(seatId: string): GameSeatInfo | undefined;
}

export interface GameInstance {
  /** 按视角裁剪后的状态；`null` 表示观战视角。 */
  serialize(viewer: ViewerId): unknown;
  handle(action: GameAction, by: string): Outcome;
  /** 开局。平台已确认发话人是房主且所有人类玩家都 Ready。 */
  begin(): Outcome;
  snapshot(): unknown;
  /** 心跳：规则计时窗口在这里推进（旧项目心跳里的玩法部分）。 */
  tick?(now: number): Effect[];
  onSeatJoin?(seat: GameSeatInfo): Effect[];
  onSeatLeave?(seat: GameSeatInfo, phase: RoomPhase): Effect[];
  /** 座位超时。托管与罚则属于游戏，不属于平台。 */
  onTimeout?(seat: GameSeatInfo): Effect[];
  dispose?(): void;
}

export interface GameModule {
  id: string;
  name: string;
  version: string;
  entry: string;
  seats: { min: number; max: number };
  allowSpectate: boolean;
  soloFill: boolean;
  roles: SeatRole[];
  /** 把房主原始设置规范化；返回的形状决定 rulesHash 与 create 的输入。 */
  normalizeConfig(raw: Record<string, unknown> | undefined): Record<string, unknown>;
  /** 只摘要真正影响对局的字段，避免"改了房间名也算房规不同"。 */
  rulesHashOf(config: Record<string, unknown>): string;
  create(config: Record<string, unknown>, ctx: GameContext): GameInstance;
  resume(snapshot: unknown, ctx: GameContext): GameInstance;
  /** 落盘快照的兼容性闸；返回 false 则平台丢弃快照并报错给房主。 */
  acceptsSnapshot?(snapshot: unknown): boolean;
  /** 可选 UI 声明；例如让游戏自己的聊天面板替代平台聊天卡。 */
  ui?: GameUiOptions;
}

/** 平台侧组装 manifest。rulesHash 由模块从规范化 config 算出，平台不参与玩法判断。 */
export function manifestOf(module: GameModule, config: Record<string, unknown>): GameManifest {
  return {
    id: module.id,
    name: module.name,
    version: module.version,
    rulesHash: module.rulesHashOf(config),
    seats: module.seats,
    allowSpectate: module.allowSpectate,
    soloFill: module.soloFill,
    roles: module.roles,
    entry: module.entry,
    ...(module.ui ? { ui: { ...module.ui } } : {}),
  };
}
