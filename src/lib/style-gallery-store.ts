import { getStyleGalleryObjectText, putStyleGalleryObject } from '@lib/hf-s3-presign';
import { styleGalleryCatalogSchema, styleGalleryExampleIndexSchema, styleGalleryItemSchema } from '@lib/style-gallery-schema';
import type { StoredStyleGalleryItem, StyleGalleryCatalog, StyleGalleryExampleIndex } from '@/types/style-gallery';

export const STYLE_GALLERY_CATALOG_KEY = 'metadata/catalog.json';
export const STYLE_GALLERY_EXAMPLE_INDEX_KEY = 'examples/index.json';
export const STYLE_GALLERY_ITEM_PREFIX = 'items';

const CACHE_TTL_MS = 30_000;
let catalogCache: { value: StyleGalleryCatalog; expiresAt: number } | null = null;
let exampleIndexCache: { value: StyleGalleryExampleIndex; expiresAt: number } | null = null;
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
      : { version: 1 as const, updatedAt: new Date(0).toISOString(), groups: [] };
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

export async function putStyleGalleryExampleIndex(index: StyleGalleryExampleIndex): Promise<void> {
  const value = styleGalleryExampleIndexSchema.parse(index);
  await putJson(STYLE_GALLERY_EXAMPLE_INDEX_KEY, value);
  exampleIndexCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
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
