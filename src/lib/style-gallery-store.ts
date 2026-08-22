import {
  getStyleGalleryObjectEtag,
  getStyleGalleryObjectText,
  getStyleGalleryObjectTextSnapshot,
  putStyleGalleryObject,
  StyleGalleryObjectConflictError,
  type StyleGalleryObjectWriteConditions,
} from '@lib/hf-s3-presign';
import {
  styleGalleryCatalogSchema,
  styleGalleryExampleIndexSchema,
  styleGalleryItemSchema,
  styleGalleryVisualIndexSchema,
} from '@lib/style-gallery-schema';
import {
  STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION,
  STYLE_GALLERY_VISUAL_INDEX_VERSION,
  STYLE_GALLERY_VISUAL_MODEL_ID,
  type StyleGalleryVisualIndex,
} from '@lib/style-gallery-visual-types';
import type { StoredStyleGalleryItem, StyleGalleryCatalog, StyleGalleryExampleIndex } from '@/types/style-gallery';

export const STYLE_GALLERY_CATALOG_KEY = 'metadata/catalog.json';
// v2 将点赞事实并入示例索引。使用版本化对象名可让旧生产部署在切换期间继续读取 v1，合并后只使用本对象。
export const STYLE_GALLERY_EXAMPLE_INDEX_KEY = 'examples/index-v2.json';
export const STYLE_GALLERY_ITEM_PREFIX = 'items';
export const STYLE_GALLERY_VISUAL_INDEX_KEY = 'metadata/visual-index-v1.json';

const CACHE_TTL_MS = 30_000;
const VISUAL_INDEX_TRANSFER_TIMEOUT_MS = 60_000;
let catalogCache: { value: StyleGalleryCatalog; expiresAt: number } | null = null;
let exampleIndexCache: { value: StyleGalleryExampleIndex; etag: string | null; expiresAt: number } | null = null;
let exampleIndexWriteQueue: Promise<unknown> = Promise.resolve();
let visualIndexCache: { value: StyleGalleryVisualIndex; etag: string | null; expiresAt: number } | null = null;
let visualIndexWriteQueue: Promise<unknown> = Promise.resolve();
let visualIndexRefreshPromise: Promise<void> | null = null;
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

/** 写路径使用带 ETag 的强制快照，以便跨 Vercel 实例进行条件提交。 */
export async function getStyleGalleryCatalogSnapshot(): Promise<{ value: StyleGalleryCatalog; etag: string }> {
  const snapshot = await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_CATALOG_KEY);
  if (!snapshot.text) throw new Error('Style gallery catalog does not exist in HF storage.');
  if (!snapshot.etag) throw new Error('HF did not return an ETag for the style gallery catalog.');
  const value = styleGalleryCatalogSchema.parse(JSON.parse(snapshot.text));
  catalogCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return { value, etag: snapshot.etag };
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
    const snapshot = await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_EXAMPLE_INDEX_KEY);
    const value = snapshot.text
      ? styleGalleryExampleIndexSchema.parse(JSON.parse(snapshot.text))
      : { version: 2 as const, updatedAt: new Date(0).toISOString(), groups: [] };
    exampleIndexCache = { value, etag: snapshot.etag, expiresAt: now + CACHE_TTL_MS };
    return value;
  } catch (error) {
    if (!options.fresh && exampleIndexCache) {
      console.warn('[style-gallery] Serving a stale example index after an HF storage read failed.', error);
      return exampleIndexCache.value;
    }
    throw error;
  }
}

/** 写入前执行 schema 校验，并同步更新当前实例的详情缓存；可选条件用于避免覆盖跨实例并发更新。 */
export async function putStoredStyleGalleryItem(
  item: StoredStyleGalleryItem,
  conditions: StyleGalleryObjectWriteConditions = {},
): Promise<string | null> {
  const value = styleGalleryItemSchema.parse(item);
  const etag = await putJson(getStyleGalleryItemKey(value.slug), value, conditions);
  itemCache.set(value.slug, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return etag;
}

export async function putStyleGalleryCatalog(
  catalog: StyleGalleryCatalog,
  conditions: StyleGalleryObjectWriteConditions = {},
): Promise<string | null> {
  const value = styleGalleryCatalogSchema.parse(catalog);
  const etag = await putJson(STYLE_GALLERY_CATALOG_KEY, value, conditions);
  catalogCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return etag;
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
      // 页面 SSR/登录态查询通常已经读取过索引。复用带 ETag 的短期快照可省掉一次 1 MB 级下载；
      // 若其他 Vercel 实例已写入，If-Match 会返回 412，下一轮再强制读取最新对象并重放 transform。
      const cached =
        attempt === 1 && exampleIndexCache?.etag && exampleIndexCache.expiresAt > Date.now() ? exampleIndexCache : null;
      const snapshot = cached
        ? { text: null, etag: cached.etag }
        : await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_EXAMPLE_INDEX_KEY);
      const current = cached
        ? cached.value
        : snapshot.text
          ? styleGalleryExampleIndexSchema.parse(JSON.parse(snapshot.text))
          : { version: 2 as const, updatedAt: new Date(0).toISOString(), groups: [] };
      if (!cached && snapshot.text && !snapshot.etag) {
        throw new Error('HF did not return an ETag for the style gallery example index.');
      }
      const transformed = transform(current);
      // 缓存快照可能在本次请求开始前已被另一实例更新；幂等短路前用轻量 HEAD 验证 ETag。
      // ETag 已变化时下一轮强制读取正文并重放 transform，避免把陈旧状态误报为已持久化。
      if (transformed === current) {
        if (cached && (await getStyleGalleryObjectEtag(STYLE_GALLERY_EXAMPLE_INDEX_KEY)) !== snapshot.etag) {
          exampleIndexCache = null;
          await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 80)));
          continue;
        }
        exampleIndexCache = { value: current, etag: snapshot.etag, expiresAt: Date.now() + CACHE_TTL_MS };
        return current;
      }
      const next = styleGalleryExampleIndexSchema.parse(transformed);
      // 视觉索引是机器读取的派生对象；紧凑 JSON 可减少 HF 往返、序列化内存和冷实例解析成本。
      const body = new TextEncoder().encode(JSON.stringify(next));
      try {
        const etag = await putStyleGalleryObject(
          STYLE_GALLERY_EXAMPLE_INDEX_KEY,
          body,
          'application/json; charset=utf-8',
          snapshot.etag ? { ifMatch: snapshot.etag } : { ifNoneMatch: '*' },
        );
        exampleIndexCache = { value: next, etag, expiresAt: Date.now() + CACHE_TTL_MS };
        return next;
      } catch (error) {
        if (!(error instanceof StyleGalleryObjectConflictError) || attempt === 6) throw error;
        exampleIndexCache = null;
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

function createEmptyStyleGalleryVisualIndex(): StyleGalleryVisualIndex {
  return {
    version: STYLE_GALLERY_VISUAL_INDEX_VERSION,
    updatedAt: new Date(0).toISOString(),
    model: {
      id: STYLE_GALLERY_VISUAL_MODEL_ID,
      dimensions: STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION,
      quantization: 'int8-unit',
    },
    features: [],
    records: [],
  };
}

/** 视觉索引只在检索或写入时读取；Gallery SSR、搜索 prompt 和图片列表不会为它承担下载与解析成本。 */
export async function getStyleGalleryVisualIndex(options: { fresh?: boolean } = {}): Promise<StyleGalleryVisualIndex> {
  const now = Date.now();
  if (!options.fresh && visualIndexCache && visualIndexCache.expiresAt > now) return visualIndexCache.value;
  if (!options.fresh && visualIndexCache) {
    // 搜索索引过期时先返回旧快照并在后台校验 HF，避免每 30 秒后的首位访客承担整份索引下载延迟。
    // expectedCache 身份检查可防止并发上传写入的新索引被较早启动的后台读取覆盖。
    if (!visualIndexRefreshPromise) {
      const expectedCache = visualIndexCache;
      visualIndexRefreshPromise = getStyleGalleryObjectTextSnapshot(
        STYLE_GALLERY_VISUAL_INDEX_KEY,
        VISUAL_INDEX_TRANSFER_TIMEOUT_MS,
      )
        .then((snapshot) => {
          if (visualIndexCache !== expectedCache) return;
          const value = snapshot.text
            ? styleGalleryVisualIndexSchema.parse(JSON.parse(snapshot.text))
            : createEmptyStyleGalleryVisualIndex();
          visualIndexCache = { value, etag: snapshot.etag, expiresAt: Date.now() + CACHE_TTL_MS };
        })
        .catch((error) => console.warn('[style-gallery] Failed to refresh the visual index in the background.', error))
        .finally(() => {
          visualIndexRefreshPromise = null;
        });
    }
    return visualIndexCache.value;
  }
  try {
    const snapshot = await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_VISUAL_INDEX_KEY, VISUAL_INDEX_TRANSFER_TIMEOUT_MS);
    const value = snapshot.text
      ? styleGalleryVisualIndexSchema.parse(JSON.parse(snapshot.text))
      : createEmptyStyleGalleryVisualIndex();
    visualIndexCache = { value, etag: snapshot.etag, expiresAt: now + CACHE_TTL_MS };
    return value;
  } catch (error) {
    if (!options.fresh && visualIndexCache) {
      console.warn('[style-gallery] Serving a stale visual index after an HF storage read failed.', error);
      return visualIndexCache.value;
    }
    throw error;
  }
}

/**
 * 视觉索引采用与点赞索引相同的 ETag 重放策略。它是派生数据，因此调用方必须先提交 item/example 真相源；
 * 索引写失败时报告可修复错误，绝不能回滚一张已经成功上传且通过对象校验的图片。
 */
export function mutateStyleGalleryVisualIndex(
  transform: (current: StyleGalleryVisualIndex) => StyleGalleryVisualIndex,
): Promise<StyleGalleryVisualIndex> {
  const operation = async () => {
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const cached =
        attempt === 1 && visualIndexCache?.etag && visualIndexCache.expiresAt > Date.now() ? visualIndexCache : null;
      const snapshot = cached
        ? { text: null, etag: cached.etag }
        : await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_VISUAL_INDEX_KEY, VISUAL_INDEX_TRANSFER_TIMEOUT_MS);
      const current = cached
        ? cached.value
        : snapshot.text
          ? styleGalleryVisualIndexSchema.parse(JSON.parse(snapshot.text))
          : createEmptyStyleGalleryVisualIndex();
      if (!cached && snapshot.text && !snapshot.etag) throw new Error('HF did not return an ETag for the visual index.');
      const next = styleGalleryVisualIndexSchema.parse(transform(current));
      const body = new TextEncoder().encode(`${JSON.stringify(next, null, 2)}\n`);
      try {
        const etag = await putStyleGalleryObject(
          STYLE_GALLERY_VISUAL_INDEX_KEY,
          body,
          'application/json; charset=utf-8',
          snapshot.etag ? { ifMatch: snapshot.etag } : { ifNoneMatch: '*' },
        );
        visualIndexCache = { value: next, etag, expiresAt: Date.now() + CACHE_TTL_MS };
        return next;
      } catch (error) {
        if (!(error instanceof StyleGalleryObjectConflictError) || attempt === 6) throw error;
        visualIndexCache = null;
        await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 80)));
      }
    }
    throw new Error('Failed to update the visual index after concurrent write retries.');
  };
  const result = visualIndexWriteQueue.then(operation, operation);
  visualIndexWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * 清除 item/catalog/example 真相源缓存，供多对象写入完成后强制重新校验。
 * 视觉索引是独立派生对象，不在这里连带清除；否则每次图片 metadata 更新后紧接着写索引时，
 * 都会无意义地重新下载整个向量文件。视觉索引自身用 ETag 冲突重放保证跨实例一致性。
 */
export function invalidateStyleGalleryStoreCache(): void {
  catalogCache = null;
  exampleIndexCache = null;
  itemCache.clear();
}

async function putJson(
  key: string,
  value: unknown,
  conditions: StyleGalleryObjectWriteConditions = {},
): Promise<string | null> {
  const body = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
  return putStyleGalleryObject(key, body, 'application/json; charset=utf-8', conditions);
}
