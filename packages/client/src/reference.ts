import {
  isValidGameReferenceEntry,
  isValidPackRelativePath,
  parseGameReference,
  type GameManifest,
  type GameReferenceDocument,
} from '@lizardon386/core-abi';
import type { FetchImpl } from './module-loader.js';

/** 静态资料只认纯文本与图片；渲染走 textContent，永远不解析 HTML。 */

export const DEFAULT_REFERENCE_TITLE = '规则与资料';
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|svg|gif)$/i;

export type ReferenceLoad =
  | { ok: true; doc: GameReferenceDocument }
  | { ok: false; message: string };

function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, '');
}

function packUrl(origin: string, gameId: string, path: string): string {
  const encoded = path.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `${trimOrigin(origin)}/games/${encodeURIComponent(gameId)}/${encoded}`;
}

export function referenceDocumentUrl(origin: string, manifest: GameManifest): string | null {
  const entry = manifest.reference?.entry;
  if (!entry || !isValidGameReferenceEntry(entry)) return null;
  return packUrl(origin, manifest.id, entry);
}

export function referenceImageUrl(origin: string, gameId: string, path: string): string | null {
  if (!isValidPackRelativePath(path) || !IMAGE_EXTENSION.test(path)) return null;
  return packUrl(origin, gameId, path);
}

export async function loadGameReference(
  manifest: GameManifest,
  origin: string,
  fetchImpl: FetchImpl = fetch,
): Promise<ReferenceLoad> {
  if (!manifest.reference) return { ok: false, message: '这个游戏没有提供规则与资料。' };
  const url = referenceDocumentUrl(origin, manifest);
  if (!url) return { ok: false, message: '规则资料入口不是合法的包内 .json 路径。' };
  try {
    const response = await fetchImpl(url, { mode: 'cors' });
    if (!response.ok) return { ok: false, message: `规则资料读取失败（HTTP ${response.status}）。` };
    const parsed = parseGameReference(await response.text());
    if (!parsed.ok) return { ok: false, message: `规则资料格式有误：${parsed.error}` };
    return { ok: true, doc: parsed.doc };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `规则资料读取失败：${detail}` };
  }
}

/** 返回面板标题（文档自带 title 优先，缺省用「规则与资料」）。 */
export function renderReference(
  host: HTMLElement,
  doc: GameReferenceDocument,
  origin: string,
  gameId: string,
): string {
  const owner = host.ownerDocument;
  host.replaceChildren();
  for (const group of doc.groups) {
    const section = owner.createElement('section');
    section.className = 'reference-group';
    const heading = owner.createElement('h4');
    heading.className = 'reference-group-title';
    heading.textContent = group.title;
    section.append(heading);
    for (const item of group.items) {
      const article = owner.createElement('article');
      article.className = 'reference-item';
      if (item.title) {
        const title = owner.createElement('h5');
        title.className = 'reference-item-title';
        title.textContent = item.title;
        article.append(title);
      }
      const text = owner.createElement('p');
      text.className = 'reference-text';
      text.textContent = item.text;
      article.append(text);
      for (const image of item.images ?? []) {
        const url = referenceImageUrl(origin, gameId, image.path);
        if (!url) continue;
        const figure = owner.createElement('figure');
        figure.className = 'reference-figure';
        const img = owner.createElement('img');
        img.className = 'reference-image';
        img.src = url;
        img.alt = image.alt;
        img.loading = 'lazy';
        figure.append(img);
        if (image.caption) {
          const caption = owner.createElement('figcaption');
          caption.textContent = image.caption;
          figure.append(caption);
        }
        article.append(figure);
      }
      section.append(article);
    }
    host.append(section);
  }
  return doc.title ?? DEFAULT_REFERENCE_TITLE;
}
