import type {
  GameReferenceDocument,
  GameReferenceGroup,
  GameReferenceImage,
  GameReferenceItem,
} from './manifest.js';

/**
 * 游戏静态资料：平台只认纯文本 + 图片，不解析 HTML / Markdown。
 * 这一份解析器由平台客户端和 sdk-tools 共用，校验口径只有一处。
 */
export const GAME_REFERENCE_LIMITS = {
  documentBytes: 64 * 1024,
  groups: 20,
  items: 120,
  groupId: 64,
  documentTitle: 40,
  groupTitle: 40,
  itemTitle: 60,
  text: 2000,
  imagesPerItem: 6,
  entryLength: 256,
  alt: 120,
  caption: 120,
} as const;

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'];

export type GameReferenceParseResult =
  | { ok: true; doc: GameReferenceDocument }
  | { ok: false; error: string };

class ReferenceCheckError extends Error {}

function fail(path: string, message: string): never {
  throw new ReferenceCheckError(path ? `${path} ${message}` : message);
}

function chars(value: string): number {
  return [...value].length;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 包内相对路径：不接受绝对路径、反斜杠、`..` 段和空段。 */
export function isValidPackRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.length > GAME_REFERENCE_LIMITS.entryLength) return false;
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  if (/[\u0000-\u001f]/.test(value)) return false;
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** reference.entry 指向包内 JSON 文档。 */
export function isValidGameReferenceEntry(value: unknown): value is string {
  return isValidPackRelativePath(value) && /\.json$/i.test(value);
}

function readText(value: unknown, path: string, limit: number, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string') fail(path, '必须是字符串');
  if (value.length === 0) fail(path, '不能为空');
  if (chars(value) > limit) fail(path, `超过 ${limit} 字`);
  return value;
}

function readImage(value: unknown, path: string): GameReferenceImage {
  if (!isObject(value)) fail(path, '必须是对象');
  const imagePath = value.path;
  if (!isValidPackRelativePath(imagePath)) fail(`${path}.path`, '必须是合法的包内相对路径');
  if (!IMAGE_EXTENSIONS.some((ext) => imagePath.toLowerCase().endsWith(`.${ext}`))) {
    fail(`${path}.path`, `扩展名只允许 ${IMAGE_EXTENSIONS.join(' / ')}`);
  }
  const alt = readText(value.alt, `${path}.alt`, GAME_REFERENCE_LIMITS.alt, true) as string;
  const caption = readText(value.caption, `${path}.caption`, GAME_REFERENCE_LIMITS.caption, false);
  return { path: imagePath, alt, ...(caption === undefined ? {} : { caption }) };
}

function readItem(value: unknown, path: string): GameReferenceItem {
  if (!isObject(value)) fail(path, '必须是对象');
  const title = readText(value.title, `${path}.title`, GAME_REFERENCE_LIMITS.itemTitle, false);
  const text = readText(value.text, `${path}.text`, GAME_REFERENCE_LIMITS.text, true) as string;
  let images: GameReferenceImage[] | undefined;
  if (value.images !== undefined) {
    if (!Array.isArray(value.images)) fail(`${path}.images`, '必须是数组');
    if (value.images.length > GAME_REFERENCE_LIMITS.imagesPerItem) {
      fail(`${path}.images`, `每项最多 ${GAME_REFERENCE_LIMITS.imagesPerItem} 张图`);
    }
    images = value.images.map((image, index) => readImage(image, `${path}.images[${index}]`));
  }
  return { text, ...(title === undefined ? {} : { title }), ...(images === undefined ? {} : { images }) };
}

function readGroup(value: unknown, path: string, seenIds: Set<string>): GameReferenceGroup {
  if (!isObject(value)) fail(path, '必须是对象');
  if (typeof value.id !== 'string' || value.id.length === 0) fail(`${path}.id`, '必须是非空字符串');
  if (chars(value.id) > GAME_REFERENCE_LIMITS.groupId) fail(`${path}.id`, `超过 ${GAME_REFERENCE_LIMITS.groupId} 字`);
  if (seenIds.has(value.id)) fail(`${path}.id`, '与前面的分组重复');
  seenIds.add(value.id);
  const title = readText(value.title, `${path}.title`, GAME_REFERENCE_LIMITS.groupTitle, true) as string;
  if (!Array.isArray(value.items)) fail(`${path}.items`, '必须是数组');
  const items = value.items.map((item, index) => readItem(item, `${path}.items[${index}]`));
  return { id: value.id, title, items };
}

function parseDocument(value: unknown): GameReferenceDocument {
  if (!isObject(value)) fail('', '资料文档必须是对象');
  if (value.version !== 1) fail('version', '当前只支持 1');
  const title = readText(value.title, 'title', GAME_REFERENCE_LIMITS.documentTitle, false);
  if (!Array.isArray(value.groups)) fail('groups', '必须是数组');
  if (value.groups.length === 0) fail('groups', '至少要有一个分组');
  if (value.groups.length > GAME_REFERENCE_LIMITS.groups) fail('groups', `最多 ${GAME_REFERENCE_LIMITS.groups} 组`);
  const seenIds = new Set<string>();
  const groups = value.groups.map((group, index) => readGroup(group, `groups[${index}]`, seenIds));
  const totalItems = groups.reduce((sum, group) => sum + group.items.length, 0);
  if (totalItems > GAME_REFERENCE_LIMITS.items) fail('groups', `条数合计最多 ${GAME_REFERENCE_LIMITS.items} 条`);
  return { version: 1, ...(title === undefined ? {} : { title }), groups };
}

/**
 * 校验并规范化资料文档。输入可以是已解析的对象，也可以是原始 JSON 文本；
 * 失败时返回一句可以直接显示给开发者的中文原因。
 */
export function parseGameReference(value: unknown): GameReferenceParseResult {
  try {
    let raw = value;
    if (typeof value === 'string') {
      if (utf8Bytes(value) > GAME_REFERENCE_LIMITS.documentBytes) {
        fail('', `文档超过 ${GAME_REFERENCE_LIMITS.documentBytes} 字节`);
      }
      try {
        raw = JSON.parse(value) as unknown;
      } catch {
        fail('', '不是合法的 JSON');
      }
    }
    let bytes: number;
    try {
      bytes = utf8Bytes(JSON.stringify(raw) ?? '');
    } catch {
      fail('', '文档无法序列化');
    }
    if (bytes > GAME_REFERENCE_LIMITS.documentBytes) {
      fail('', `文档超过 ${GAME_REFERENCE_LIMITS.documentBytes} 字节`);
    }
    return { ok: true, doc: parseDocument(raw) };
  } catch (error) {
    if (error instanceof ReferenceCheckError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
