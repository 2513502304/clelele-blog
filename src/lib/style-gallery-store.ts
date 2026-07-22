import {
  getStyleGalleryObjectText,
  getStyleGalleryObjectTextSnapshot,
  putStyleGalleryObject,
  StyleGalleryObjectConflictError,
} from '@lib/hf-s3-presign';
import { styleGalleryCatalogSchema, styleGalleryExampleIndexSchema, styleGalleryItemSchema } from '@lib/style-gallery-schema';
import type { StoredStyleGalleryItem, StyleGalleryCatalog, StyleGalleryExampleIndex } from '@/types/style-gallery';

export const STYLE_GALLERY_CATALOG_KEY = 'metadata/catalog.json';
// v2 将点赞事实并入示例索引。使用版本化对象名可让旧生产部署在切换期间继续读取 v1，合并后只使用本对象。
export const STYLE_GALLERY_EXAMPLE_INDEX_KEY = 'examples/index-v2.json';
export const STYLE_GALLERY_ITEM_PREFIX = 'items';

const CACHE_TTL_MS = 30_000;
let catalogCache: { value: StyleGalleryCatalog; expiresAt: number } | null = null;
let exampleIndexCache: { value: StyleGalleryExampleIndex; expiresAt: number } | null = null;
let exampleIndexWriteQueue: Promise<unknown> = Promise.resolve();
const itemCache = new Map<string, { value: StoredStyleGalleryItem; expiresAt: number }>();

/** 将经过校验的 slug 转换为 HF 中的详情对象键。 */
export function getStyleGalleryItemKey(slug: string): string {
  return `${STYLE_GALLERY_ITEM_PREFIX}/${slug}.json`;
}

/**
 * 读取并校验 Gallery catalog。短期内存缓存减少 HF 往返；非强制刷新失败时允许返回已有旧值，
 * 但进程首次读取失败仍会向上抛错，避免把“无数据”误报为有效空列表。
 */
export async function getStyleGalleryCatalog(options: { fresh?: boolean } = {}): Promise<StyleGalleryCatalog> {
  const now = Date.now();
  if (!options.fresh && catalogCache && catalogCache.expiresAt > now) return catalogCache.value;

  try {
    const raw = await getStyleGalleryObjectText(STYLE_GALLERY_CATALOG_KEY);
    if (!raw) throw new Error('Style gallery catalog does not exist in HF storage.');
    const value = styleGalleryCatalogSchema.parse(JSON.parse(raw));
    catalogCache = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  } catch (error) {
    if (!options.fresh && catalogCache) {
      console.warn('[style-gallery] Serving a stale catalog after an HF storage read failed.', error);
      return catalogCache.value;
    }
    throw error;
  }
}

/** 按需读取单个详情 item，不会为列表页预取所有 item 文件。 */
export async function getStoredStyleGalleryItem(
  slug: string,
  options: { fresh?: boolean } = {},
): Promise<StoredStyleGalleryItem | null> {
  const now = Date.now();
  const cached = itemCache.get(slug);
  if (!options.fresh && cached && cached.expiresAt > now) return cached.value;

  try {
    const raw = await getStyleGalleryObjectText(getStyleGalleryItemKey(slug));
    if (!raw) return null;
    const value = styleGalleryItemSchema.parse(JSON.parse(raw));
    itemCache.set(slug, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  } catch (error) {
    if (!options.fresh && cached) {
      console.warn(`[style-gallery] Serving a stale item (${slug}) after an HF storage read failed.`, error);
      return cached.value;
    }
    throw error;
  }
}

/** 读取 Sub-gallery 总览索引；索引尚未创建时返回带固定版本的空结构。 */
export async function getStyleGalleryExampleIndex(options: { fresh?: boolean } = {}): Promise<StyleGalleryExampleIndex> {
  const now = Date.now();
  if (!options.fresh && exampleIndexCache && exampleIndexCache.expiresAt > now) return exampleIndexCache.value;

  try {
    const raw = await getStyleGalleryObjectText(STYLE_GALLERY_EXAMPLE_INDEX_KEY);
    const value = raw
      ? styleGalleryExampleIndexSchema.parse(JSON.parse(raw))
      : { version: 2 as const, updatedAt: new Date(0).toISOString(), groups: [] };
    exampleIndexCache = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  } catch (error) {
    if (!options.fresh && exampleIndexCache) {
      console.warn('[style-gallery] Serving a stale example index after an HF storage read failed.', error);
      return exampleIndexCache.value;
    }
    throw error;
  }
}

/** 写入前执行 schema 校验，并同步更新当前实例的详情缓存。 */
export async function putStoredStyleGalleryItem(item: StoredStyleGalleryItem): Promise<void> {
  const value = styleGalleryItemSchema.parse(item);
  await putJson(getStyleGalleryItemKey(value.slug), value);
  itemCache.set(value.slug, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export async function putStyleGalleryCatalog(catalog: StyleGalleryCatalog): Promise<void> {
  const value = styleGalleryCatalogSchema.parse(catalog);
  await putJson(STYLE_GALLERY_CATALOG_KEY, value);
  catalogCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
}

/**
 * 以 `examples/index-v2.json` 为单一示例索引执行条件更新。所有上传、删除和点赞都必须经过这里，
 * 这样跨 Vercel 实例的并发写会收到 412 并基于最新 ETag 重放，不会静默覆盖别人的点赞。
 */
export function mutateStyleGalleryExampleIndex(
  transform: (current: StyleGalleryExampleIndex) => StyleGalleryExampleIndex,
): Promise<StyleGalleryExampleIndex> {
  const operation = async () => {
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const snapshot = await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_EXAMPLE_INDEX_KEY);
      const current = snapshot.text
        ? styleGalleryExampleIndexSchema.parse(JSON.parse(snapshot.text))
        : { version: 2 as const, updatedAt: new Date(0).toISOString(), groups: [] };
      if (snapshot.text && !snapshot.etag) throw new Error('HF did not return an ETag for the style gallery example index.');
      const next = styleGalleryExampleIndexSchema.parse(transform(current));
      const body = new TextEncoder().encode(`${JSON.stringify(next, null, 2)}\n`);
      try {
        await putStyleGalleryObject(
          STYLE_GALLERY_EXAMPLE_INDEX_KEY,
          body,
          'application/json; charset=utf-8',
          snapshot.etag ? { ifMatch: snapshot.etag } : { ifNoneMatch: '*' },
        );
        exampleIndexCache = { value: next, expiresAt: Date.now() + CACHE_TTL_MS };
        return next;
      } catch (error) {
        if (!(error instanceof StyleGalleryObjectConflictError) || attempt === 6) throw error;
        await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 80)));
      }
    }
    throw new Error('Failed to update the style gallery example index after concurrent write retries.');
  };

  const result = exampleIndexWriteQueue.then(operation, operation);
  exampleIndexWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** 清除当前实例内所有 Gallery 元数据缓存，供多对象写入完成后强制重新校验。 */
export function invalidateStyleGalleryStoreCache(): void {
  catalogCache = null;
  exampleIndexCache = null;
  itemCache.clear();
}

async function putJson(key: string, value: unknown): Promise<void> {
  const body = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
  await putStyleGalleryObject(key, body, 'application/json; charset=utf-8');
}
