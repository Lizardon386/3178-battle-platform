import { parseSeatOptions, type SeatOptionField, type SeatOptionsSpec, type SeatRole } from '@lizardon386/core-abi';

/** 平台只负责按声明渲染座位选项，值由游戏 normalizeSeatOptions 收口。 */

export function seatOptionsSpec(value: unknown): SeatOptionsSpec | null {
  const parsed = parseSeatOptions(value);
  return parsed.ok ? parsed.spec : null;
}

export function seatOptionFields(spec: SeatOptionsSpec, role: SeatRole): SeatOptionField[] {
  return spec.fields.filter((field) => field.roles.includes(role));
}

export type SeatOptionReader = (field: SeatOptionField) => string | boolean | number | undefined;

export function seatOptionValues(fields: SeatOptionField[], read: SeatOptionReader): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
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

export function seatOptionLabel(field: SeatOptionField, value: unknown): string {
  if (field.type === 'boolean') return value ? '开' : '关';
  if (field.type === 'enum') {
    return field.options.find((option) => option.value === value)?.label ?? String(value ?? field.default);
  }
  return String(value ?? field.default);
}
