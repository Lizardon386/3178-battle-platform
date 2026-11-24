/**
 * 清单声明的房间级配置：校验与规范化。
 * 与旧实现的两处差异：非法值拒绝而不是静默回落；整数只接受安全整数。
 */

export type FieldType = 'boolean' | 'enum' | 'integer';
export type MemberRole = 'host' | 'player' | 'ai' | 'spectator';
export type FieldOption = { value: string; label: string; description?: string };
export type FieldSpec = {
  key: string;
  type: FieldType;
  label: string;
  description?: string;
  default: unknown;
  options?: FieldOption[];
  roles?: MemberRole[];
  dependsOn?: string;
  min?: number;
  max?: number;
  step?: number;
};

export type NormalizeResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

export const FIELD_LIMITS = {
  fields: 24,
  seatOptions: 8,
  keyLength: 32,
  labelLength: 40,
  descriptionLength: 200,
  enumOptions: 8,
  enumValueLength: 32,
  enumLabelLength: 24,
  integerSpan: 1000,
} as const;

const KEY_PATTERN = /^[a-z][a-z0-9-]*$/;
const ENUM_VALUE_PATTERN = /^[a-z0-9-]+$/;
const ROLES = new Set<MemberRole>(['host', 'player', 'ai', 'spectator']);

function chars(value: string): number {
  return [...value].length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function appliesTo(field: FieldSpec, role?: MemberRole): boolean {
  if (role === undefined) return true;
  return !field.roles || field.roles.length === 0 || field.roles.includes(role);
}

function checkValue(field: FieldSpec, value: unknown): string | null {
  if (field.type === 'boolean') {
    return typeof value === 'boolean' ? null : `${field.key} 必须是布尔值`;
  }
  if (field.type === 'enum') {
    if (typeof value !== 'string') return `${field.key} 必须是字符串`;
    if (!field.options?.some((option) => option.value === value)) {
      return `${field.key} 必须是清单声明的选项之一`;
    }
    return null;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return `${field.key} 必须是安全整数`;
  }
  if (field.min !== undefined && value < field.min) return `${field.key} 不能小于 ${field.min}`;
  if (field.max !== undefined && value > field.max) return `${field.key} 不能大于 ${field.max}`;
  return null;
}

function checkField(field: unknown, path: string): string | null {
  if (!isPlainObject(field)) return `${path} 必须是对象`;
  if (typeof field.key !== 'string' || !KEY_PATTERN.test(field.key) || field.key.length > FIELD_LIMITS.keyLength) {
    return `${path}.key 必须匹配 ${KEY_PATTERN}`;
  }
  if (field.type !== 'boolean' && field.type !== 'enum' && field.type !== 'integer') {
    return `${path}.type 只支持 boolean / enum / integer`;
  }
  if (typeof field.label !== 'string' || chars(field.label) === 0 || chars(field.label) > FIELD_LIMITS.labelLength) {
    return `${path}.label 必须是 1–${FIELD_LIMITS.labelLength} 字`;
  }
  if (field.description !== undefined) {
    if (typeof field.description !== 'string' || chars(field.description) > FIELD_LIMITS.descriptionLength) {
      return `${path}.description 最多 ${FIELD_LIMITS.descriptionLength} 字`;
    }
  }
  if (field.roles !== undefined) {
    if (!Array.isArray(field.roles) || field.roles.length === 0) return `${path}.roles 必须是非空数组`;
    for (const role of field.roles) if (!ROLES.has(role as MemberRole)) return `${path}.roles 含未知角色`;
  }
  if (field.dependsOn !== undefined && (typeof field.dependsOn !== 'string' || !KEY_PATTERN.test(field.dependsOn))) {
    return `${path}.dependsOn 必须是字段键`;
  }

  if (field.type === 'boolean') {
    return typeof field.default === 'boolean' ? null : `${path}.default 必须是布尔值`;
  }
  if (field.type === 'enum') {
    if (!Array.isArray(field.options) || field.options.length === 0) return `${path}.options 至少要有一项`;
    if (field.options.length > FIELD_LIMITS.enumOptions) return `${path}.options 最多 ${FIELD_LIMITS.enumOptions} 项`;
    const seen = new Set<string>();
    for (let index = 0; index < field.options.length; index += 1) {
      const option = field.options[index];
      const optionPath = `${path}.options[${index}]`;
      if (!isPlainObject(option)) return `${optionPath} 必须是对象`;
      if (typeof option.value !== 'string' || !ENUM_VALUE_PATTERN.test(option.value) || option.value.length > FIELD_LIMITS.enumValueLength) {
        return `${optionPath}.value 必须匹配 ${ENUM_VALUE_PATTERN}`;
      }
      if (seen.has(option.value)) return `${optionPath}.value 与前面的选项重复`;
      seen.add(option.value);
      if (typeof option.label !== 'string' || chars(option.label) === 0 || chars(option.label) > FIELD_LIMITS.enumLabelLength) {
        return `${optionPath}.label 必须是 1–${FIELD_LIMITS.enumLabelLength} 字`;
      }
    }
    if (typeof field.default !== 'string' || !seen.has(field.default)) {
      return `${path}.default 必须是 options 里的某个 value`;
    }
    return null;
  }

  for (const name of ['default', 'min', 'max'] as const) {
    if (typeof field[name] !== 'number' || !Number.isSafeInteger(field[name])) {
      return `${path}.${name} 必须是安全整数`;
    }
  }
  const min = field.min as number;
  const max = field.max as number;
  const initial = field.default as number;
  if (min > initial) return `${path}.min 不能大于 default`;
  if (initial > max) return `${path}.max 不能小于 default`;
  if (max - min > FIELD_LIMITS.integerSpan) {
    return `${path}.max 与 min 的跨度最多 ${FIELD_LIMITS.integerSpan}`;
  }
  if (field.step !== undefined) {
    if (typeof field.step !== 'number' || !Number.isSafeInteger(field.step) || field.step <= 0) {
      return `${path}.step 必须是正整数`;
    }
  }
  return null;
}

/** 校验一组字段声明；数量上限按 config / seatOptions 分别传入。 */
export function validateFieldSpecs(fields: unknown, maxItems: number, path = 'fields'): string | null {
  if (!Array.isArray(fields)) return `${path} 必须是数组`;
  if (fields.length > maxItems) return `${path} 最多 ${maxItems} 项`;
  const seen = new Set<string>();
  for (let index = 0; index < fields.length; index += 1) {
    const error = checkField(fields[index], `${path}[${index}]`);
    if (error) return error;
    const key = (fields[index] as FieldSpec).key;
    if (seen.has(key)) return `${path}[${index}].key 与前面的字段重复`;
    seen.add(key);
  }
  return null;
}

/** 按声明补齐默认值并校验；未声明键、类型不符、越界都拒绝。 */
export function normalizeFields(fields: FieldSpec[], raw: unknown, role?: MemberRole): NormalizeResult {
  const input = raw === undefined || raw === null ? {} : raw;
  if (!isPlainObject(input)) return { ok: false, error: '配置必须是对象' };
  const byKey = new Map<string, FieldSpec>(fields.map((field) => [field.key, field]));
  for (const key of Object.keys(input)) {
    const field = byKey.get(key);
    if (!field) return { ok: false, error: `未声明的键: ${key}` };
    if (!appliesTo(field, role)) return { ok: false, error: `字段 ${key} 不适用于角色 ${role}` };
  }
  const value: Record<string, unknown> = {};
  for (const field of fields) {
    if (!appliesTo(field, role)) continue;
    const candidate = Object.hasOwn(input, field.key) ? input[field.key] : field.default;
    const error = checkValue(field, candidate);
    if (error) return { ok: false, error };
    value[field.key] = candidate;
  }
  return { ok: true, value };
}
