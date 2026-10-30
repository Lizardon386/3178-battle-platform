import type { SeatOptionField, SeatOptionsSpec, SeatRole } from '@lizardon386/core-abi';

/** 平台侧的座位选项兜底：游戏没有 normalizeSeatOptions 时，按 manifest 声明取默认/收口。 */

function applies(field: SeatOptionField, role: SeatRole): boolean {
  return field.roles.includes(role);
}

export function defaultsForSeat(spec: SeatOptionsSpec | undefined, role: SeatRole): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of spec?.fields ?? []) {
    if (applies(field, role)) out[field.key] = field.default;
  }
  return out;
}

export function coerceSeatOptions(
  spec: SeatOptionsSpec | undefined,
  role: SeatRole,
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out = defaultsForSeat(spec, role);
  for (const field of spec?.fields ?? []) {
    if (!applies(field, role)) continue;
    const value = raw?.[field.key];
    if (field.type === 'boolean') {
      if (typeof value === 'boolean') out[field.key] = value;
      continue;
    }
    if (field.type === 'enum') {
      if (typeof value === 'string' && field.options.some((option) => option.value === value)) {
        out[field.key] = value;
      }
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) out[field.key] = value;
  }
  return out;
}
