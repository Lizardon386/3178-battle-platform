import type { RuleConfigField, RuleConfigSpec } from './manifest.js';

/**
 * 建房规则表单的校验口径。声明的是表单项，不是值；
 * 值仍由 roomCreate.config 传入，由游戏 normalizeConfig 规范化、服务端校验。
 */
export const RULE_CONFIG_LIMITS = {
  fields: 24,
  keyLength: 32,
  label: 40,
  description: 200,
  enumOptions: 8,
  enumValueLength: 32,
  enumLabel: 24,
  integerSpan: 1000,
} as const;

const KEY_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const ENUM_VALUE_PATTERN = /^[a-z0-9-]{1,32}$/;

export type RuleConfigParseResult =
  | { ok: true; spec: RuleConfigSpec }
  | { ok: false; error: string };

class RuleConfigCheckError extends Error {}

function fail(path: string, message: string): never {
  throw new RuleConfigCheckError(path ? `${path} ${message}` : message);
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
  if (chars(value) > RULE_CONFIG_LIMITS.description) fail(path, `超过 ${RULE_CONFIG_LIMITS.description} 字`);
  return value;
}

function readField(value: unknown, path: string, seenKeys: Set<string>): RuleConfigField {
  if (!isObject(value)) fail(path, '必须是对象');
  if (typeof value.key !== 'string' || !KEY_PATTERN.test(value.key)) {
    fail(`${path}.key`, '必须匹配 ^[a-z][a-z0-9-]{0,31}$');
  }
  if (seenKeys.has(value.key)) fail(`${path}.key`, '与前面的字段重复');
  seenKeys.add(value.key);
  const label = readLabel(value.label, `${path}.label`, RULE_CONFIG_LIMITS.label);
  const description = readDescription(value.description, `${path}.description`);

  if (value.type === 'boolean') {
    if (typeof value.default !== 'boolean') fail(`${path}.default`, 'boolean 字段的默认值必须是布尔值');
    return { key: value.key, label, type: 'boolean', default: value.default, ...(description === undefined ? {} : { description }) };
  }

  if (value.type === 'enum') {
    if (!Array.isArray(value.options)) fail(`${path}.options`, '必须是数组');
    if (value.options.length === 0) fail(`${path}.options`, '至少要有一个选项');
    if (value.options.length > RULE_CONFIG_LIMITS.enumOptions) {
      fail(`${path}.options`, `最多 ${RULE_CONFIG_LIMITS.enumOptions} 个选项`);
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
      const optionLabel = readLabel(option.label, `${optionPath}.label`, RULE_CONFIG_LIMITS.enumLabel);
      const optionDescription = readDescription(option.description, `${optionPath}.description`);
      return { value: option.value, label: optionLabel, ...(optionDescription === undefined ? {} : { description: optionDescription }) };
    });
    if (typeof value.default !== 'string') fail(`${path}.default`, 'enum 字段的默认值必须是字符串');
    if (!seenValues.has(value.default)) fail(`${path}.default`, '必须是 options 里的某个 value');
    return { key: value.key, label, type: 'enum', default: value.default, options, ...(description === undefined ? {} : { description }) };
  }

  if (value.type === 'integer') {
    if (typeof value.default !== 'number' || !Number.isSafeInteger(value.default)) {
      fail(`${path}.default`, 'integer 字段的默认值必须是整数');
    }
    if (typeof value.min !== 'number' || !Number.isSafeInteger(value.min)) fail(`${path}.min`, '必须是整数');
    if (typeof value.max !== 'number' || !Number.isSafeInteger(value.max)) fail(`${path}.max`, '必须是整数');
    if (value.min > value.default) fail(`${path}.min`, '不能大于 default');
    if (value.default > value.max) fail(`${path}.max`, '不能小于 default');
    if (value.max - value.min > RULE_CONFIG_LIMITS.integerSpan) {
      fail(`${path}.max`, `与 min 的跨度最多 ${RULE_CONFIG_LIMITS.integerSpan}`);
    }
    let step: number | undefined;
    if (value.step !== undefined) {
      if (typeof value.step !== 'number' || !Number.isSafeInteger(value.step) || value.step <= 0) {
        fail(`${path}.step`, '必须是正整数');
      }
      step = value.step;
    }
    return {
      key: value.key,
      label,
      type: 'integer',
      default: value.default,
      min: value.min,
      max: value.max,
      ...(step === undefined ? {} : { step }),
      ...(description === undefined ? {} : { description }),
    };
  }

  return fail(`${path}.type`, '只支持 boolean / enum / integer');
}

/** 校验并规范化规则表单声明；失败时返回一句可以直接显示给开发者的中文原因。 */
export function parseRuleConfig(value: unknown): RuleConfigParseResult {
  try {
    if (!isObject(value)) fail('', '规则表单声明必须是对象');
    if (!Array.isArray(value.fields)) fail('fields', '必须是数组');
    if (value.fields.length === 0) fail('fields', '至少要有一项');
    if (value.fields.length > RULE_CONFIG_LIMITS.fields) fail('fields', `最多 ${RULE_CONFIG_LIMITS.fields} 项`);
    const seenKeys = new Set<string>();
    const fields = value.fields.map((field, index) => readField(field, `fields[${index}]`, seenKeys));
    return { ok: true, spec: { fields } };
  } catch (error) {
    if (error instanceof RuleConfigCheckError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
