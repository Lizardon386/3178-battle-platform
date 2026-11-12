import { createHash } from 'node:crypto';

/** canonical JSON 不接受的值（类型、范围、编码问题）。 */
export class CanonicalJsonError extends Error {}

function fail(path: string, message: string): never {
  throw new CanonicalJsonError(path ? `${path}: ${message}` : message);
}

/**
 * 拒绝孤立代理项：JSON.stringify 会把它们写成转义序列，
 * 但 UTF-8 无法表示，跨语言哈希会分叉。
 */
function assertWellFormed(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail(path, 'contains a lone surrogate');
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail(path, 'contains a lone surrogate');
    }
  }
}

function serialize(value: unknown, path: string, stack: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      assertWellFormed(value, path);
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) fail(path, 'must be a finite number');
      if (!Number.isSafeInteger(value)) fail(path, 'must be a safe integer');
      return Object.is(value, -0) ? '0' : String(value);
    case 'object':
      break;
    default:
      fail(path, `unsupported value type ${typeof value}`);
  }

  if (Array.isArray(value)) {
    if (stack.has(value)) fail(path, 'circular reference');
    stack.add(value);
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      items.push(serialize(value[index], `${path}[${index}]`, stack));
    }
    stack.delete(value);
    return `[${items.join(',')}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(path, 'must be a plain object');
  if (Object.getOwnPropertySymbols(value).length > 0) fail(path, 'must not have symbol keys');
  if (stack.has(value)) fail(path, 'circular reference');
  stack.add(value);
  const record = value as Record<string, unknown>;
  // UTF-8 字节序等价于 Unicode 码点序；JS 默认排序是 UTF-16 码元序，非 BMP 字符会排错。
  const keys = Object.keys(record).sort((left, right) =>
    Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')));
  const pairs: string[] = [];
  for (const key of keys) {
    assertWellFormed(key, path);
    const childPath = path ? `${path}.${key}` : key;
    pairs.push(`${JSON.stringify(key)}:${serialize(record[key], childPath, stack)}`);
  }
  stack.delete(value);
  return `{${pairs.join(',')}}`;
}

/** 按协议 v0 的 canonical JSON 规则序列化；非法输入抛 CanonicalJsonError。 */
export function canonicalJson(value: unknown): string {
  return serialize(value, '$', new Set());
}

export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), 'utf8');
}

/** `rulesHash` 的指定算法：canonical JSON → UTF-8 → SHA-256 小写 hex。 */
export function rulesHashOf(value: unknown): string {
  return createHash('sha256').update(canonicalJsonBytes(value)).digest('hex');
}
