/**
 * 稳定摘要：把任意 JSON 值规范化后算出可跨端复现的短哈希。
 * 只回答"两端配置是否一致"，不做安全用途；包完整性另走 sha256。
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = (1n << 64n) - 1n;

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function encode(value: unknown, seen: Set<object>, out: string[]): void {
  if (value === null) {
    out.push('null');
    return;
  }
  if (typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') {
    out.push(JSON.stringify(value) ?? 'null');
    return;
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    out.push('null');
    return;
  }
  if (typeof value === 'bigint') {
    out.push(`${value.toString(16)}n`);
    return;
  }
  if (!isPlainObject(value) && !Array.isArray(value)) {
    out.push(`"${String(value)}"`);
    return;
  }
  if (seen.has(value)) throw new TypeError('规范化失败：存在循环引用');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      out.push('[');
      value.forEach((item, i) => {
        if (i) out.push(',');
        encode(item, seen, out);
      });
      out.push(']');
      return;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    out.push('{');
    keys.forEach((k, i) => {
      if (i) out.push(',');
      out.push(JSON.stringify(k), ':');
      encode(obj[k], seen, out);
    });
    out.push('}');
  } finally {
    seen.delete(value);
  }
}

/** 键排序、数组保序、undefined 归 null 的确定性 JSON。 */
export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  encode(value, new Set(), out);
  return out.join('');
}

function fnv1a64(text: string): bigint {
  const bytes = new TextEncoder().encode(text);
  let hash = FNV_OFFSET;
  for (const b of bytes) {
    hash ^= BigInt(b);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash;
}

/** 16 位十六进制稳定摘要。同一输入在 Node 与浏览器下结果必须一致。 */
export function stableDigest(value: unknown): string {
  return fnv1a64(canonicalJson(value)).toString(16).padStart(16, '0');
}

export function digestsMatch(a: string | undefined, b: string | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return a.toLowerCase() === b.toLowerCase();
}
