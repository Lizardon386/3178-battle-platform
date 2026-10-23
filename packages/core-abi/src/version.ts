/** 游戏 ABI 和宿主支持的模式/接口版本。 */

export const API_VERSION = 1;

export const SUPPORTED_API_VERSIONS: readonly number[] = [API_VERSION];

export const GAME_MODES = ['turn', 'realtime'] as const;
export type GameMode = (typeof GAME_MODES)[number];

/** 当前宿主只实际支持 turn；realtime 是规划中的 profile。 */
export const SUPPORTED_MODES: Readonly<Record<GameMode, readonly number[]>> = {
  turn: [1],
  realtime: [],
};

export const DEFAULT_MODE: GameMode = 'turn';
