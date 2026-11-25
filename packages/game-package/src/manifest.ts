/**
 * 游戏清单校验：与 protocol/game-package/manifest.schema.json 对齐。
 * 只做纯数据校验，不碰文件系统；打包器与注册表共用同一份规则。
 */

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CAPABILITY_PATTERN = /^[A-Za-z][A-Za-z0-9.-]*$/;
const FIELD_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;
const OPTION_VALUE_PATTERN = /^[a-z0-9-]+$/;
const ASSET_PATH_PATTERN = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type GameFieldType = 'boolean' | 'enum' | 'integer';
export type GameRole = 'host' | 'player' | 'ai' | 'spectator';
export type LateJoin = 'spectator' | 'player' | 'deny';
/** process：入口自读 boot 并连接 IPC；module：入口导出 createAuthority，由平台 runner 加载。 */
export type AuthorityModel = 'process' | 'module';

export interface GameFieldOption {
  value: string;
  label: string;
}

export interface GameField {
  key: string;
  type: GameFieldType;
  label: string;
  default: unknown;
  description?: string;
  options?: GameFieldOption[];
  roles?: GameRole[];
  dependsOn?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface GameAsset {
  path: string;
  sha256: string;
  bytes: number;
}

export interface GameSignature {
  algorithm: 'ed25519';
  value: string;
  publicKey?: string;
}

export interface GameManifest {
  id: string;
  name: string;
  version: string;
  requiredCapabilities?: string[];
  lateJoin?: LateJoin;
  authorityModel?: AuthorityModel;
  platformRequirements: {
    protocolVersion: 1;
    minPlayers: number;
    maxPlayers: number;
    allowSpectate?: boolean;
    soloFill?: boolean;
  };
  entryPoints: {
    authority: string;
    web?: string;
  };
  assets?: GameAsset[];
  signature?: GameSignature;
  rulesHash?: string;
  sessionConfig: {
    fields: GameField[];
    seatOptions?: GameField[];
  };
  reference: {
    entry: string;
  };
}

function fail(message: string): never {
  throw new ManifestError(message);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[], where: string): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${where} 含未知字段：${key}`);
  }
};

const readString = (
  value: Record<string, unknown>,
  key: string,
  where: string,
  rules: { min?: number; max?: number; pattern?: RegExp; patternText?: string } = {},
): string => {
  const raw = value[key];
  if (typeof raw !== 'string') fail(`${where}.${key} 必须是字符串`);
  if (rules.min !== undefined && raw.length < rules.min) fail(`${where}.${key} 太短`);
  if (rules.max !== undefined && raw.length > rules.max) fail(`${where}.${key} 太长`);
  if (rules.pattern && !rules.pattern.test(raw)) {
    fail(`${where}.${key} 格式不合法${rules.patternText ? `（${rules.patternText}）` : ''}`);
  }
  return raw;
};

const readOptionalBoolean = (value: Record<string, unknown>, key: string, where: string): boolean | undefined => {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'boolean') fail(`${where}.${key} 必须是布尔值`);
  return raw;
};

const readInteger = (
  value: Record<string, unknown>,
  key: string,
  where: string,
  rules: { min?: number; max?: number } = {},
): number => {
  const raw = value[key];
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) fail(`${where}.${key} 必须是整数`);
  if (rules.min !== undefined && raw < rules.min) fail(`${where}.${key} 不能小于 ${rules.min}`);
  if (rules.max !== undefined && raw > rules.max) fail(`${where}.${key} 不能大于 ${rules.max}`);
  return raw;
};

/** 入口与资产路径：相对、无 `..`、无绝对路径，字符集与 schema 一致。 */
export function validateAssetPath(value: unknown, where = '资产路径'): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${where} 必须是非空字符串`);
  if (value.length > 256) fail(`${where} 太长`);
  if (!ASSET_PATH_PATTERN.test(value)) fail(`${where} 不合法：${value}`);
  return value;
}

function readField(raw: unknown, where: string): GameField {
  if (!isRecord(raw)) fail(`${where} 不是对象`);
  assertOnlyKeys(
    raw,
    ['key', 'type', 'label', 'default', 'description', 'options', 'roles', 'dependsOn', 'min', 'max', 'step'],
    where,
  );
  const key = readString(raw, 'key', where, { pattern: FIELD_KEY_PATTERN, max: 32, patternText: '小写字母开头的 slug' });
  const type = raw.type;
  if (type !== 'boolean' && type !== 'enum' && type !== 'integer') fail(`${where}.type 不合法`);
  const label = readString(raw, 'label', where, { min: 1, max: 40 });
  if (!Object.prototype.hasOwnProperty.call(raw, 'default')) fail(`${where}.default 缺失`);
  const field: GameField = { key, type, label, default: raw.default };

  if (raw.description !== undefined) {
    field.description = readString(raw, 'description', where, { max: 200 });
  }
  if (raw.dependsOn !== undefined) {
    field.dependsOn = readString(raw, 'dependsOn', where, { pattern: FIELD_KEY_PATTERN, max: 32 });
  }
  if (raw.roles !== undefined) {
    if (!Array.isArray(raw.roles) || raw.roles.length === 0) fail(`${where}.roles 必须是非空数组`);
    const roles: GameRole[] = [];
    for (const role of raw.roles) {
      if (role !== 'host' && role !== 'player' && role !== 'ai' && role !== 'spectator') {
        fail(`${where}.roles 含未知角色：${String(role)}`);
      }
      if (roles.includes(role)) fail(`${where}.roles 重复：${role}`);
      roles.push(role);
    }
    field.roles = roles;
  }
  if (raw.options !== undefined) {
    if (!Array.isArray(raw.options) || raw.options.length === 0 || raw.options.length > 8) {
      fail(`${where}.options 必须是 1–8 项`);
    }
    const options: GameFieldOption[] = [];
    for (const option of raw.options) {
      if (!isRecord(option)) fail(`${where}.options 项不是对象`);
      assertOnlyKeys(option, ['value', 'label'], `${where}.options`);
      const optionValue = readString(option, 'value', `${where}.options`, {
        pattern: OPTION_VALUE_PATTERN,
        max: 32,
      });
      if (options.some((item) => item.value === optionValue)) fail(`${where}.options 值重复：${optionValue}`);
      options.push({ value: optionValue, label: readString(option, 'label', `${where}.options`, { min: 1, max: 24 }) });
    }
    field.options = options;
  }
  if (raw.min !== undefined) {
    field.min = readInteger(raw, 'min', where);
  }
  if (raw.max !== undefined) {
    field.max = readInteger(raw, 'max', where);
  }
  if (raw.step !== undefined) {
    field.step = readInteger(raw, 'step', where, { min: 1 });
  }

  if (type === 'boolean' && typeof field.default !== 'boolean') fail(`${where}.default 必须是布尔值`);
  if (type === 'enum') {
    if (!field.options) fail(`${where}.options 缺失（enum 字段必须声明选项）`);
    if (typeof field.default !== 'string' || !field.options.some((option) => option.value === field.default)) {
      fail(`${where}.default 必须是 options 里的值`);
    }
  }
  if (type === 'integer') {
    if (typeof field.default !== 'number' || !Number.isSafeInteger(field.default)) {
      fail(`${where}.default 必须是整数`);
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      fail(`${where}.min 不能大于 max`);
    }
    if (field.min !== undefined && field.default < field.min) fail(`${where}.default 小于 min`);
    if (field.max !== undefined && field.default > field.max) fail(`${where}.default 大于 max`);
  }
  return field;
}

function readFields(raw: unknown, where: string, maxItems: number): GameField[] {
  if (!Array.isArray(raw)) fail(`${where} 必须是数组`);
  if (raw.length > maxItems) fail(`${where} 最多 ${maxItems} 项`);
  const fields: GameField[] = [];
  for (const item of raw) {
    const field = readField(item, `${where}[${fields.length}]`);
    if (fields.some((existing) => existing.key === field.key)) fail(`${where} 键重复：${field.key}`);
    fields.push(field);
  }
  for (const field of fields) {
    if (field.dependsOn === undefined) continue;
    if (field.dependsOn === field.key) fail(`${where}.${field.key} 不能依赖自己`);
    if (!fields.some((other) => other.key === field.dependsOn)) {
      fail(`${where}.${field.key} 依赖了不存在的键：${field.dependsOn}`);
    }
  }
  return fields;
}

function readManifest(value: unknown): GameManifest {
  if (!isRecord(value)) fail('清单不是对象');
  assertOnlyKeys(
    value,
    [
      'id',
      'name',
      'version',
      'requiredCapabilities',
      'lateJoin',
      'authorityModel',
      'platformRequirements',
      'entryPoints',
      'assets',
      'signature',
      'rulesHash',
      'sessionConfig',
      'reference',
    ],
    '清单',
  );

  const id = readString(value, 'id', '清单', { pattern: ID_PATTERN, patternText: '小写字母、数字、点、下划线、连字符' });
  const name = readString(value, 'name', '清单', { min: 1, max: 64 });
  const version = readString(value, 'version', '清单', { min: 1, max: 32 });

  const manifest: GameManifest = {
    id,
    name,
    version,
    platformRequirements: { protocolVersion: 1, minPlayers: 1, maxPlayers: 2 },
    entryPoints: { authority: '' },
    sessionConfig: { fields: [] },
    reference: { entry: '' },
  };

  if (value.requiredCapabilities !== undefined) {
    if (!Array.isArray(value.requiredCapabilities) || value.requiredCapabilities.length > 32) {
      fail('清单.requiredCapabilities 必须是不超过 32 项的数组');
    }
    const capabilities: string[] = [];
    for (const capability of value.requiredCapabilities) {
      if (typeof capability !== 'string' || !CAPABILITY_PATTERN.test(capability) || capability.length > 64) {
        fail(`清单.requiredCapabilities 含非法能力：${String(capability)}`);
      }
      if (capabilities.includes(capability)) fail(`清单.requiredCapabilities 重复：${capability}`);
      capabilities.push(capability);
    }
    manifest.requiredCapabilities = capabilities;
  }

  if (value.lateJoin !== undefined) {
    if (value.lateJoin !== 'spectator' && value.lateJoin !== 'player' && value.lateJoin !== 'deny') {
      fail('清单.lateJoin 不合法');
    }
    manifest.lateJoin = value.lateJoin;
  }

  if (value.authorityModel !== undefined) {
    if (value.authorityModel !== 'process' && value.authorityModel !== 'module') {
      fail('清单.authorityModel 不合法');
    }
    manifest.authorityModel = value.authorityModel;
  }

  if (!isRecord(value.platformRequirements)) fail('清单.platformRequirements 必须是对象');
  const requirements = value.platformRequirements;
  assertOnlyKeys(
    requirements,
    ['protocolVersion', 'minPlayers', 'maxPlayers', 'allowSpectate', 'soloFill'],
    '清单.platformRequirements',
  );
  const protocolVersion = readInteger(requirements, 'protocolVersion', '清单.platformRequirements', { min: 1, max: 1 });
  const minPlayers = readInteger(requirements, 'minPlayers', '清单.platformRequirements', { min: 1, max: 8 });
  const maxPlayers = readInteger(requirements, 'maxPlayers', '清单.platformRequirements', { min: 2, max: 8 });
  if (minPlayers > maxPlayers) fail('清单.platformRequirements.minPlayers 不能大于 maxPlayers');
  const allowSpectate = readOptionalBoolean(requirements, 'allowSpectate', '清单.platformRequirements');
  const soloFill = readOptionalBoolean(requirements, 'soloFill', '清单.platformRequirements');
  manifest.platformRequirements = {
    protocolVersion: protocolVersion as 1,
    minPlayers,
    maxPlayers,
    ...(allowSpectate === undefined ? {} : { allowSpectate }),
    ...(soloFill === undefined ? {} : { soloFill }),
  };

  if (!isRecord(value.entryPoints)) fail('清单.entryPoints 必须是对象');
  assertOnlyKeys(value.entryPoints, ['authority', 'web'], '清单.entryPoints');
  const authority = validateAssetPath(value.entryPoints.authority, '清单.entryPoints.authority');
  const web = value.entryPoints.web === undefined
    ? undefined
    : validateAssetPath(value.entryPoints.web, '清单.entryPoints.web');
  manifest.entryPoints = { authority, ...(web === undefined ? {} : { web }) };

  if (value.assets !== undefined) {
    if (!Array.isArray(value.assets)) fail('清单.assets 必须是数组');
    const seen = new Set<string>();
    const assets: GameAsset[] = [];
    for (const item of value.assets) {
      if (!isRecord(item)) fail('清单.assets 项不是对象');
      assertOnlyKeys(item, ['path', 'sha256', 'bytes'], '清单.assets');
      const path = validateAssetPath(item.path, '清单.assets.path');
      if (seen.has(path.toLowerCase())) fail(`清单.assets 路径重复：${path}`);
      seen.add(path.toLowerCase());
      const sha256 = readString(item, 'sha256', '清单.assets', { pattern: SHA256_PATTERN, patternText: '64 位小写十六进制' });
      const bytes = readInteger(item, 'bytes', '清单.assets', { min: 0 });
      assets.push({ path, sha256, bytes });
    }
    manifest.assets = assets;
  }

  if (value.signature !== undefined) {
    if (!isRecord(value.signature)) fail('清单.signature 必须是对象');
    assertOnlyKeys(value.signature, ['algorithm', 'value', 'publicKey'], '清单.signature');
    if (value.signature.algorithm !== 'ed25519') fail('清单.signature.algorithm 只支持 ed25519');
    const signature: GameSignature = {
      algorithm: 'ed25519',
      value: readString(value.signature, 'value', '清单.signature', { min: 16, max: 512 }),
    };
    if (value.signature.publicKey !== undefined) {
      signature.publicKey = readString(value.signature, 'publicKey', '清单.signature', { min: 16, max: 256 });
    }
    manifest.signature = signature;
  }

  if (value.rulesHash !== undefined) {
    manifest.rulesHash = readString(value, 'rulesHash', '清单', {
      pattern: SHA256_PATTERN,
      patternText: '64 位小写十六进制',
    });
  }

  if (!isRecord(value.sessionConfig)) fail('清单.sessionConfig 必须是对象');
  assertOnlyKeys(value.sessionConfig, ['fields', 'seatOptions'], '清单.sessionConfig');
  const fields = readFields(value.sessionConfig.fields, '清单.sessionConfig.fields', 24);
  const seatOptions = value.sessionConfig.seatOptions === undefined
    ? undefined
    : readFields(value.sessionConfig.seatOptions, '清单.sessionConfig.seatOptions', 8);
  manifest.sessionConfig = { fields, ...(seatOptions === undefined ? {} : { seatOptions }) };

  if (!isRecord(value.reference)) fail('清单.reference 必须是对象');
  assertOnlyKeys(value.reference, ['entry'], '清单.reference');
  manifest.reference = { entry: validateAssetPath(value.reference.entry, '清单.reference.entry') };

  return manifest;
}

/** 校验并返回一份新的清单对象；任何未知字段都会被拒绝，避免拼写错误静默生效。 */
export function validateManifest(value: unknown): GameManifest {
  return readManifest(value);
}
