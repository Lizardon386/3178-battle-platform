import { SEAT_ROLES } from './seats.js';
import type { SeatRole } from './seats.js';

/**
 * 座位级配置：每个非空座位自己的选项（例如电脑难度、座位颜色）。
 * 平台只透传 options，不解释具体含义；游戏用 normalizeSeatOptions 给默认值。
 */
export const SEAT_OPTIONS_LIMITS = {
  fields: 24,
  keyLength: 32,
  label: 40,
  description: 200,
  enumOptions: 8,
  enumValueLength: 32,
  enumLabel: 24,
  integerSpan: 1000,
  colorLength: 64,
} as const;

export interface SeatOptionFieldBase {
  key: string;
  label: string;
  description?: string;
  /** 该字段对哪些座位显示；至少一项。 */
  roles: SeatRole[];
}

export type SeatOptionField =
  | (SeatOptionFieldBase & { type: 'boolean'; default: boolean })
  | (SeatOptionFieldBase & {
      type: 'enum';
      default: string;
      options: Array<{ value: string; label: string; color?: string }>;
    })
  | (SeatOptionFieldBase & { type: 'integer'; default: number; min: number; max: number; step?: number });

export interface SeatOptionsSpec {
  fields: SeatOptionField[];
}

const KEY_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const ENUM_VALUE_PATTERN = /^[a-z0-9-]{1,32}$/;
const ROLE_SET = new Set<string>(SEAT_ROLES);

export type SeatOptionsParseResult = { ok: true; spec: SeatOptionsSpec } | { ok: false; error: string };

class SeatOptionsCheckError extends Error {}

function fail(path: string, message: string): never {
  throw new SeatOptionsCheckError(path ? `${path} ${message}` : message);
}

function chars(value: string): number {
  return [...value].length;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readLabel(value: unknown, path: string, limit: number): string {
  if (typeof value !== 'string') fail(path, '必须是字符串');
  if (value.length === 0) fail(path, '不能为空');
  if (chars(value) > limit) fail(path, `超过 ${limit} 字`);
  return value;
}

function readDescription(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(path, '必须是字符串');
  if (chars(value) > SEAT_OPTIONS_LIMITS.description) fail(path, `超过 ${SEAT_OPTIONS_LIMITS.description} 字`);
  return value;
}

function readColor(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(path, '必须是字符串');
  if (value.length === 0) fail(path, '不能为空');
  if (chars(value) > SEAT_OPTIONS_LIMITS.colorLength) fail(path, `超过 ${SEAT_OPTIONS_LIMITS.colorLength} 字`);
  return value;
}

function readRoles(value: unknown, path: string): SeatRole[] {
  if (!Array.isArray(value)) fail(path, '必须是数组');
  if (value.length === 0) fail(path, '至少要有一个角色');
  const seen = new Set<string>();
  const roles: SeatRole[] = [];
  for (const role of value) {
    if (typeof role !== 'string' || !ROLE_SET.has(role)) fail(path, `只允许 ${SEAT_ROLES.join(' / ')}`);
    if (seen.has(role)) fail(path, `角色重复：${role}`);
    seen.add(role);
    roles.push(role as SeatRole);
  }
  return roles;
}

function readField(value: unknown, path: string, seenKeys: Set<string>): SeatOptionField {
  if (!isObject(value)) fail(path, '必须是对象');
  if (typeof value.key !== 'string' || !KEY_PATTERN.test(value.key)) {
    fail(`${path}.key`, '必须匹配 ^[a-z][a-z0-9-]{0,31}$');
  }
  if (seenKeys.has(value.key)) fail(`${path}.key`, '与前面的字段重复');
  seenKeys.add(value.key);
  const label = readLabel(value.label, `${path}.label`, SEAT_OPTIONS_LIMITS.label);
  const description = readDescription(value.description, `${path}.description`);
  const roles = readRoles(value.roles, `${path}.roles`);
  const base = { key: value.key, label, roles, ...(description === undefined ? {} : { description }) };

  if (value.type === 'boolean') {
    if (typeof value.default !== 'boolean') fail(`${path}.default`, 'boolean 字段的默认值必须是布尔值');
    return { ...base, type: 'boolean', default: value.default };
  }

  if (value.type === 'enum') {
    if (!Array.isArray(value.options)) fail(`${path}.options`, '必须是数组');
    if (value.options.length === 0) fail(`${path}.options`, '至少要有一个选项');
    if (value.options.length > SEAT_OPTIONS_LIMITS.enumOptions) {
      fail(`${path}.options`, `最多 ${SEAT_OPTIONS_LIMITS.enumOptions} 个选项`);
    }
    const seenValues = new Set<string>();
    const options = value.options.map((option, index) => {
      const optionPath = `${path}.options[${index}]`;
      if (!isObject(option)) fail(optionPath, '必须是对象');
      if (typeof option.value !== 'string' || !ENUM_VALUE_PATTERN.test(option.value)) {
        fail(`${optionPath}.value`, '必须匹配 ^[a-z0-9-]{1,32}$');
      }
      if (seenValues.has(option.value)) fail(`${optionPath}.value`, '与前面的选项重复');
      seenValues.add(option.value);
      const optionLabel = readLabel(option.label, `${optionPath}.label`, SEAT_OPTIONS_LIMITS.enumLabel);
      const color = readColor(option.color, `${optionPath}.color`);
      return { value: option.value, label: optionLabel, ...(color === undefined ? {} : { color }) };
    });
    if (typeof value.default !== 'string') fail(`${path}.default`, 'enum 字段的默认值必须是字符串');
    if (!seenValues.has(value.default)) fail(`${path}.default`, '必须是 options 里的某个 value');
    return { ...base, type: 'enum', default: value.default, options };
  }

  if (value.type === 'integer') {
    if (typeof value.default !== 'number' || !Number.isSafeInteger(value.default)) {
      fail(`${path}.default`, 'integer 字段的默认值必须是整数');
    }
    if (typeof value.min !== 'number' || !Number.isSafeInteger(value.min)) fail(`${path}.min`, '必须是整数');
    if (typeof value.max !== 'number' || !Number.isSafeInteger(value.max)) fail(`${path}.max`, '必须是整数');
    if (value.min > value.default) fail(`${path}.min`, '不能大于 default');
    if (value.default > value.max) fail(`${path}.max`, '不能小于 default');
    if (value.max - value.min > SEAT_OPTIONS_LIMITS.integerSpan) {
      fail(`${path}.max`, `与 min 的跨度最多 ${SEAT_OPTIONS_LIMITS.integerSpan}`);
    }
    let step: number | undefined;
    if (value.step !== undefined) {
      if (typeof value.step !== 'number' || !Number.isSafeInteger(value.step) || value.step <= 0) {
        fail(`${path}.step`, '必须是正整数');
      }
      step = value.step;
    }
    return {
      ...base,
      type: 'integer',
      default: value.default,
      min: value.min,
      max: value.max,
      ...(step === undefined ? {} : { step }),
    };
  }

  return fail(`${path}.type`, '只支持 boolean / enum / integer');
}

/** 校验并规范化座位选项声明；失败时返回可直接显示的中文原因。 */
export function parseSeatOptions(value: unknown): SeatOptionsParseResult {
  try {
    if (!isObject(value)) fail('', '座位选项声明必须是对象');
    if (!Array.isArray(value.fields)) fail('fields', '必须是数组');
    if (value.fields.length === 0) fail('fields', '至少要有一项');
    if (value.fields.length > SEAT_OPTIONS_LIMITS.fields) fail('fields', `最多 ${SEAT_OPTIONS_LIMITS.fields} 项`);
    const seenKeys = new Set<string>();
    const fields = value.fields.map((field, index) => readField(field, `fields[${index}]`, seenKeys));
    return { ok: true, spec: { fields } };
  } catch (error) {
    if (error instanceof SeatOptionsCheckError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
