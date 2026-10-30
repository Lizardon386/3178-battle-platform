import { isValidGameReferenceEntry, parseRuleConfig, parseSeatOptions, type GameAsset, type GameManifest, type GameModule } from '@lizardon386/core-abi';

export * from '@lizardon386/core-abi';

/** 平台侧组装 manifest。rulesHash 由模块从规范化 config 算出，平台不参与玩法判断。 */
export function manifestOf(
  module: GameModule,
  config: Record<string, unknown>,
  assets?: readonly GameAsset[],
): GameManifest {
  // 加载器已经把坏声明挡在模块外；这里再挡一次，避免测试/手工构造的模块把坏声明带进房间。
  const ruleConfig = module.ruleConfig && parseRuleConfig(module.ruleConfig).ok
    ? { fields: module.ruleConfig.fields.map((field) => ({ ...field })) }
    : null;
  const reference = module.reference && isValidGameReferenceEntry(module.reference.entry)
    ? { ...module.reference }
    : null;
  const seatOptions = module.seatOptions && parseSeatOptions(module.seatOptions).ok
    ? {
        fields: module.seatOptions.fields.map((field) => ({
          ...field,
          ...(field.type === 'enum' ? { options: field.options.map((option) => ({ ...option })) } : {}),
        })),
      }
    : null;
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
    ...(ruleConfig ? { ruleConfig } : {}),
    ...(reference ? { reference } : {}),
    ...(seatOptions ? { seatOptions } : {}),
  };
}
