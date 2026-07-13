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

export function getStyleGalleryItemKey(slug: string): string {
  return `${STYLE_GALLERY_ITEM_PREFIX}/${slug}.json`;
}

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
    if (!options.fresh && catalogCache) return catalogCache.value;
    throw error;
  }
}

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
    if (!options.fresh && cached) return cached.value;
    throw error;
  }
}

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
    if (!options.fresh && exampleIndexCache) return exampleIndexCache.value;
    throw error;
  }
}

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

export function invalidateStyleGalleryStoreCache(): void {
  catalogCache = null;
  exampleIndexCache = null;
  itemCache.clear();
}

async function putJson(key: string, value: unknown): Promise<void> {
  const body = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
  await putStyleGalleryObject(key, body, 'application/json; charset=utf-8');
}
