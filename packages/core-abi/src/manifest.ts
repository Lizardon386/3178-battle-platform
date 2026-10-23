import type { SeatRole } from './seats.js';

export interface GameUiOptions {
  /** 游戏内聊天由平台聊天卡提供，还是由游戏自己的界面提供。 */
  chat?: 'platform' | 'game';
}

/** 游戏模块对外声明的自己：房主建房、客户端校验、模块下发三处都要用它。 */
export interface GameManifest {
  id: string;
  name: string;
  /** 语义化版本，只用于展示与"版本不同"的提示文案。 */
  version: string;
  /** 房规摘要：由 create 时的 config 算出，与 config 一起构成入房闸。 */
  rulesHash: string;
  seats: { min: number; max: number };
  allowSpectate: boolean;
  /** 游戏是否支持 AI 填充席位（war3 的"电脑玩家"）。 */
  soloFill: boolean;
  /** 需要的席位角色集合，平台据此拒绝模块乱用角色。 */
  roles: SeatRole[];
  /** 客户端 UI 入口，相对该模块的 base URL。 */
  entry: string;
  /** 下发给客户端的资源清单；hash 为 'sha256:<hex>' 或裸 hex。 */
  assets?: GameAsset[];
  /** 可选 UI 能力；缺省时按平台默认（聊天卡由平台显示）。 */
  ui?: GameUiOptions;
}

export interface GameAsset {
  path: string;
  hash: string;
  bytes?: number;
}
