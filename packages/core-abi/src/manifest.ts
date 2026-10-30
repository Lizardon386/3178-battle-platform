import type { SeatRole } from './seats.js';
import type { SeatOptionsSpec } from './seat-options.js';

export interface GameUiOptions {
  /** 游戏内聊天由平台聊天卡提供，还是由游戏自己的界面提供。 */
  chat?: 'platform' | 'game';
}

type RuleConfigFieldBase = {
  key: string;
  label: string;
  description?: string;
};

/** 建房时房主需要填的一项规则；只声明表单项，值仍走 roomCreate.config。 */
export type RuleConfigField =
  | (RuleConfigFieldBase & { type: 'boolean'; default: boolean })
  | (RuleConfigFieldBase & {
      type: 'enum';
      default: string;
      options: Array<{ value: string; label: string; description?: string }>;
    })
  | (RuleConfigFieldBase & { type: 'integer'; default: number; min: number; max: number; step?: number });

/** 游戏的规则表单声明；平台据此渲染开关，规范化与校验仍由游戏和服务端负责。 */
export interface RuleConfigSpec {
  fields: RuleConfigField[];
}

/** 游戏提供的静态资料入口；只给包内相对路径，内容懒加载。 */
export interface GameReferenceSpec {
  entry: string;
}

export interface GameReferenceDocument {
  version: 1;
  title?: string;
  groups: GameReferenceGroup[];
}

export interface GameReferenceGroup {
  id: string;
  title: string;
  items: GameReferenceItem[];
}

export interface GameReferenceItem {
  title?: string;
  text: string;
  images?: GameReferenceImage[];
}

export interface GameReferenceImage {
  path: string;
  alt: string;
  caption?: string;
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
  /** 建房时的规则表单；缺省表示这个游戏没有可配置项。 */
  ruleConfig?: RuleConfigSpec;
  /** 静态资料入口；只声明路径，文档由平台按需取。 */
  reference?: GameReferenceSpec;
  /** 座位级选项声明；平台只透传值，不解释含义。 */
  seatOptions?: SeatOptionsSpec;
}

export interface GameAsset {
  path: string;
  hash: string;
  bytes?: number;
}
