import type { GameAsset, GameManifest, GameModule } from '@bp/core-abi';

export * from '@bp/core-abi';

/** 平台侧组装 manifest。rulesHash 由模块从规范化 config 算出，平台不参与玩法判断。 */
export function manifestOf(
  module: GameModule,
  config: Record<string, unknown>,
  assets?: readonly GameAsset[],
): GameManifest {
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
    ...(assets && assets.length > 0 ? { assets: assets.map((asset) => ({ ...asset })) } : {}),
    ...(module.ui ? { ui: { ...module.ui } } : {}),
  };
}
