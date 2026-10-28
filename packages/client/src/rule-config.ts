import { parseRuleConfig, type RuleConfigField, type RuleConfigSpec } from '@lizardon386/core-abi';

/** 规则表单只做声明到值的搬运；合法性仍由游戏的 normalizeConfig 收口。 */

export function ruleConfigSpec(value: unknown): RuleConfigSpec | null {
  const parsed = parseRuleConfig(value);
  return parsed.ok ? parsed.spec : null;
}

export function ruleConfigDefaults(spec: RuleConfigSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of spec.fields) out[field.key] = field.default;
  return out;
}

export type RuleConfigReader = (field: RuleConfigField) => string | boolean | number | undefined;

export function ruleConfigFromValues(spec: RuleConfigSpec, read: RuleConfigReader): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of spec.fields) {
    const raw = read(field);
    if (field.type === 'boolean') {
      out[field.key] = typeof raw === 'boolean' ? raw : field.default;
    } else if (field.type === 'enum') {
      out[field.key] =
        typeof raw === 'string' && field.options.some((option) => option.value === raw) ? raw : field.default;
    } else {
      const number = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      out[field.key] = Number.isFinite(number) ? number : field.default;
    }
  }
  return out;
}

export interface RuleSummaryRow {
  key: string;
  label: string;
  text: string;
}

/** 房间页只读摘要：按 manifest 的字段顺序，把规范化后的值翻成中文。 */
export function ruleConfigSummary(spec: RuleConfigSpec, config: Record<string, unknown> | undefined): RuleSummaryRow[] {
  const rows: RuleSummaryRow[] = [];
  for (const field of spec.fields) {
    const value = config?.[field.key] ?? field.default;
    let text: string;
    if (field.type === 'boolean') {
      text = value ? '开' : '关';
    } else if (field.type === 'enum') {
      text = field.options.find((option) => option.value === value)?.label ?? String(value);
    } else {
      text = String(value);
    }
    rows.push({ key: field.key, label: field.label, text });
  }
  return rows;
}
