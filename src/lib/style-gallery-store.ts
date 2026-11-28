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
  styleGalleryPromptSearchIndexSchema,
  styleGalleryVisualIndexSchema,
} from '@lib/style-gallery-schema';
import {
  STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION,
  STYLE_GALLERY_VISUAL_INDEX_VERSION,
  STYLE_GALLERY_VISUAL_MODEL_ID,
  type StyleGalleryVisualIndex,
} from '@lib/style-gallery-visual-types';
import type {
  StoredStyleGalleryItem,
  StyleGalleryCatalog,
  StyleGalleryExampleIndex,
  StyleGalleryPromptSearchIndex,
} from '@/types/style-gallery';
import {
  type ExampleRoot,
  materializeExamples,
  prepareExampleRoot,
  putExampleRoot,
  queueExamplePacking,
  readExampleRootSnapshot,
  STYLE_GALLERY_EXAMPLE_INDEX_KEY,
} from './style-gallery-example-shards';

export const STYLE_GALLERY_CATALOG_KEY = 'metadata/catalog-v5.json';
export const STYLE_GALLERY_PROMPT_SEARCH_INDEX_KEY = 'metadata/prompt-search-index.json';
export { STYLE_GALLERY_EXAMPLE_INDEX_KEY };
export const STYLE_GALLERY_ITEM_PREFIX = 'items';
export const STYLE_GALLERY_VISUAL_INDEX_KEY = 'metadata/visual-index-v1.json';

const CACHE_TTL_MS = 30_000;
const VISUAL_INDEX_TRANSFER_TIMEOUT_MS = 60_000;
let catalogRead: Promise<StyleGalleryCatalog> | null = null;
let catalogReadRevision = 0;
let catalogCache: { value: StyleGalleryCatalog; expiresAt: number; etag: string | null } | null = null;
let promptSearchIndexCache: { value: StyleGalleryPromptSearchIndex; etag: string | null; expiresAt: number } | null = null;
let exampleIndexCache: { root: ExampleRoot; value: StyleGalleryExampleIndex; etag: string | null; expiresAt: number } | null =
  null;
let exampleIndexWriteQueue: Promise<unknown> = Promise.resolve();
let visualIndexCache: { value: StyleGalleryVisualIndex; etag: string | null; expiresAt: number } | null = null;
let visualIndexWriteQueue: Promise<unknown> = Promise.resolve();
let visualIndexRefreshPromise: Promise<void> | null = null;
const itemCache = new Map<string, { value: StoredStyleGalleryItem; expiresAt: number }>();

/** An in-process write or invalidation makes an older derived search snapshot ineligible immediately. */
export function getStyleGallerySearchCacheState() {
  if (!catalogCache || !exampleIndexCache || !promptSearchIndexCache) return null;
  return {
    revision: [catalogCache.value.updatedAt, exampleIndexCache.value.updatedAt, promptSearchIndexCache.value.updatedAt].join(
      '/',
    ),
    expiresAt: Math.min(catalogCache.expiresAt, exampleIndexCache.expiresAt, promptSearchIndexCache.expiresAt),
  };
}

/** 将经过校验的 slug 转换为 HF 中的详情对象键。 */
export function getStyleGalleryItemKey(slug: string): string {
  return `${STYLE_GALLERY_ITEM_PREFIX}/${slug}.json`;
}

/**
 * 读取并校验 Gallery catalog。短期内存缓存减少 HF 往返；非强制刷新失败时允许返回已有旧值，
 * 但进程首次读取失败仍会向上抛错，避免把“无数据”误报为有效空列表。
 */
export async function getStyleGalleryCatalog(
  options: { fresh?: boolean; revalidate?: boolean } = {},
): Promise<StyleGalleryCatalog> {
  const now = Date.now();
  if (!options.fresh && catalogCache && catalogCache.expiresAt > now) return catalogCache.value;
  if (!options.fresh && catalogRead) return catalogRead;
  // Concurrent cold SSR requests share one download and schema parse. Forced management reads
  // bypass this request, and a successful write prevents older reads from republishing stale data.
  if (options.fresh) invalidateCatalogRead();
  const revision = catalogReadRevision;
  const read = (async () => {
    try {
      const previous = catalogCache;
      if (
        options.revalidate &&
        !options.fresh &&
        previous?.etag &&
        (await getStyleGalleryObjectEtag(STYLE_GALLERY_CATALOG_KEY)) === previous.etag &&
        previous === catalogCache
      ) {
        previous.expiresAt = Date.now() + CACHE_TTL_MS;
        return previous.value;
      }
      const { text: raw, etag } = await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_CATALOG_KEY);
      if (!raw) throw new Error('Style gallery catalog does not exist in HF storage.');
      const value = styleGalleryCatalogSchema.parse(JSON.parse(raw));
      if (revision === catalogReadRevision) catalogCache = { value, etag, expiresAt: Date.now() + CACHE_TTL_MS };
      return value;
    } catch (error) {
      if (!options.fresh && catalogCache) {
        console.warn('[style-gallery] Serving a stale catalog after an HF storage read failed.', error);
        return catalogCache.value;
      }
      throw error;
    }
  })();
  if (!options.fresh) catalogRead = read;
  try {
    return await read;
  } finally {
    if (catalogRead === read) catalogRead = null;
  }
}

/** Detach old in-flight reads when a writer publishes or invalidates the catalog. */
function invalidateCatalogRead(): void {
  catalogReadRevision++;
  catalogRead = null;
}

/** 写路径使用带 ETag 的强制快照，以便跨 Vercel 实例进行条件提交。 */
export async function getStyleGalleryCatalogSnapshot(): Promise<{ value: StyleGalleryCatalog; etag: string }> {
  // A pending original preview may already be warming this catalog. It is only a hint:
  // the HEAD check below still validates the version used by the conditional writer.
  if (catalogRead) await catalogRead.catch(() => undefined);
  const previous = catalogCache;
  // A matching HEAD is a fresh versioned snapshot. The eventual PUT still has to match the same ETag.
  if (
    previous?.etag &&
    (await getStyleGalleryObjectEtag(STYLE_GALLERY_CATALOG_KEY)) === previous.etag &&
    previous === catalogCache
  ) {
    return { value: previous.value, etag: previous.etag };
  }
  const snapshot = await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_CATALOG_KEY);
  if (!snapshot.text) throw new Error('Style gallery catalog does not exist in HF storage.');
  if (!snapshot.etag) throw new Error('HF did not return an ETag for the style gallery catalog.');
  const value = styleGalleryCatalogSchema.parse(JSON.parse(snapshot.text));
  invalidateCatalogRead();
  catalogCache = { value, etag: snapshot.etag, expiresAt: Date.now() + CACHE_TTL_MS };
  return { value, etag: snapshot.etag };
}

/**
 * 全文 prompt 只在搜索或导入去重时读取。它与轻量 Catalog 分离，普通 SSR 不再下载和解析数 MB 文本。
 */
export async function getStyleGalleryPromptSearchIndex(
  options: { fresh?: boolean } = {},
): Promise<StyleGalleryPromptSearchIndex> {
  const now = Date.now();
  if (!options.fresh && promptSearchIndexCache && promptSearchIndexCache.expiresAt > now) {
    return promptSearchIndexCache.value;
  }
  try {
    const previous = promptSearchIndexCache;
    if (
      !options.fresh &&
      previous?.etag &&
      (await getStyleGalleryObjectEtag(STYLE_GALLERY_PROMPT_SEARCH_INDEX_KEY)) === previous.etag &&
      previous === promptSearchIndexCache
    ) {
      previous.expiresAt = now + CACHE_TTL_MS;
      return previous.value;
    }
    const snapshot = await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_PROMPT_SEARCH_INDEX_KEY);
    if (!snapshot.text) throw new Error('Style gallery prompt search index does not exist in HF storage.');
    const value = styleGalleryPromptSearchIndexSchema.parse(JSON.parse(snapshot.text));
    if (previous !== promptSearchIndexCache && !options.fresh) return promptSearchIndexCache?.value ?? value;
    promptSearchIndexCache = { value, etag: snapshot.etag, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch (error) {
    if (!options.fresh && promptSearchIndexCache) {
      console.warn('[style-gallery] Serving a stale prompt search index after an HF storage read failed.', error);
      return promptSearchIndexCache.value;
    }
    throw error;
  }
}

export async function getStyleGalleryPromptSearchIndexSnapshot(): Promise<{
  value: StyleGalleryPromptSearchIndex;
  etag: string;
}> {
  const snapshot = await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_PROMPT_SEARCH_INDEX_KEY);
  if (!snapshot.text) throw new Error('Style gallery prompt search index does not exist in HF storage.');
  if (!snapshot.etag) throw new Error('HF did not return an ETag for the style gallery prompt search index.');
  const value = styleGalleryPromptSearchIndexSchema.parse(JSON.parse(snapshot.text));
  promptSearchIndexCache = { value, etag: snapshot.etag, expiresAt: Date.now() + CACHE_TTL_MS };
  return { value, etag: snapshot.etag };
}

/** 按需读取单个详情 item，不会为列表页预取所有 item 文件。 */
export async function getStoredStyleGalleryItem(
  slug: string,
  options: { fresh?: boolean; followRedirect?: boolean } = {},
): Promise<StoredStyleGalleryItem | null> {
  return readStoredItem(slug, options, new Set());
}

async function readStoredItem(
  slug: string,
  options: { fresh?: boolean; followRedirect?: boolean },
  visited: Set<string>,
): Promise<StoredStyleGalleryItem | null> {
  if (visited.has(slug) || visited.size >= 32) throw new Error('Invalid gallery merge redirect chain.');
  visited.add(slug);
  const now = Date.now();
  const cached = itemCache.get(slug);
  if (!options.fresh && cached && cached.expiresAt > now) return cached.value;

  try {
    const raw = await getStyleGalleryObjectText(getStyleGalleryItemKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.mergedInto === 'string' && /^[a-z0-9-]{1,160}$/i.test(parsed.mergedInto)) {
      // Management reads must not silently edit a different card through a retired slug.
      if (options.fresh && !options.followRedirect) return null;
      return readStoredItem(parsed.mergedInto, options, visited);
    }
    const value = styleGalleryItemSchema.parse(parsed);
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
export async function getStyleGalleryExampleIndex(
  options: { fresh?: boolean; revalidate?: boolean } = {},
): Promise<StyleGalleryExampleIndex> {
  const now = Date.now();
  if (!options.fresh && exampleIndexCache && exampleIndexCache.expiresAt > now) return exampleIndexCache.value;

  try {
    const previous = exampleIndexCache;
    if (
      options.revalidate &&
      !options.fresh &&
      previous?.etag &&
      (await getStyleGalleryObjectEtag(STYLE_GALLERY_EXAMPLE_INDEX_KEY)) === previous.etag &&
      previous === exampleIndexCache
    ) {
      previous.expiresAt = Date.now() + CACHE_TTL_MS;
      return previous.value;
    }
    const snapshot = await readExampleRootSnapshot();
    const value = await materializeExamples(snapshot.root);
    if (previous !== exampleIndexCache && !options.fresh) return exampleIndexCache?.value ?? value;
    exampleIndexCache = { root: snapshot.root, value, etag: snapshot.etag, expiresAt: Date.now() + CACHE_TTL_MS };
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
  const etag = await putStyleGalleryObject(
    STYLE_GALLERY_CATALOG_KEY,
    new TextEncoder().encode(JSON.stringify(value)),
    'application/json; charset=utf-8',
    conditions,
  );
  invalidateCatalogRead();
  catalogCache = { value, etag, expiresAt: Date.now() + CACHE_TTL_MS };
  return etag;
}

export async function putStyleGalleryPromptSearchIndex(
  index: StyleGalleryPromptSearchIndex,
  conditions: StyleGalleryObjectWriteConditions = {},
): Promise<string | null> {
  const value = styleGalleryPromptSearchIndexSchema.parse(index);
  const etag = await putJson(STYLE_GALLERY_PROMPT_SEARCH_INDEX_KEY, value, conditions);
  promptSearchIndexCache = { value, etag, expiresAt: Date.now() + CACHE_TTL_MS };
  return etag;
}

/** Full-index management transforms and single-item saves share the publication CAS and replay queue. */
export function mutateStyleGalleryExampleIndex(
  transform: (current: StyleGalleryExampleIndex) => StyleGalleryExampleIndex,
  sourceSlug?: string,
  beforePublish?: () => Promise<void>,
): Promise<StyleGalleryExampleIndex> {
  const operation = async () => {
    for (let attempt = 1; attempt <= 6; attempt++) {
      const cached =
        attempt === 1 && exampleIndexCache?.etag && exampleIndexCache.expiresAt > Date.now() ? exampleIndexCache : null;
      const snapshot = cached ?? (await readExampleRootSnapshot());
      const { root, etag } = snapshot;
      if ('exists' in snapshot && snapshot.exists && !etag) throw Error('Missing ETag for the gallery example index.');
      // V2 transforms still see the entire legacy document until an operator activates sharding.
      const scope = root.version === 3 ? sourceSlug : undefined;
      const current = cached && !scope ? cached.value : await materializeExamples(root, scope);
      const transformed = transform(current);
      if (transformed === current) {
        if (cached && (await getStyleGalleryObjectEtag(STYLE_GALLERY_EXAMPLE_INDEX_KEY)) !== etag) {
          exampleIndexCache = null;
          continue;
        }
        return current;
      }
      const next = styleGalleryExampleIndexSchema.parse(transformed);
      const updated = await prepareExampleRoot(root, current, next, scope);
      // In a multi-object transaction only immutable packs may precede the catalog.
      // A failed catalog CAS is the caller's conflict and must not replay this root CAS.
      await beforePublish?.();
      try {
        const published = await putExampleRoot(updated, etag ? { ifMatch: etag } : { ifNoneMatch: '*' });
        // A scoped edit may share a previous complete snapshot, but must never cache its slice as the whole gallery.
        const previous = exampleIndexCache;
        if (!scope || (previous && previous.etag === etag)) {
          const full =
            scope && previous
              ? { ...next, groups: [...previous.value.groups.filter((g) => g.sourceSlug !== scope), ...next.groups] }
              : next;
          exampleIndexCache = { root: updated, value: full, etag: published, expiresAt: Date.now() + CACHE_TTL_MS };
        } else exampleIndexCache = null;
        queueExamplePacking(updated);
        return next;
      } catch (error) {
        if (!(error instanceof StyleGalleryObjectConflictError) || attempt === 6) throw error;
        exampleIndexCache = null;
        await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 80)));
      }
    }
    throw Error('Failed to update the style gallery example index after concurrent write retries.');
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
  const expectedCache = visualIndexCache;
  try {
    const snapshot = await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_VISUAL_INDEX_KEY, VISUAL_INDEX_TRANSFER_TIMEOUT_MS);
    const value = snapshot.text
      ? styleGalleryVisualIndexSchema.parse(JSON.parse(snapshot.text))
      : createEmptyStyleGalleryVisualIndex();
    if (visualIndexCache === expectedCache) visualIndexCache = { value, etag: snapshot.etag, expiresAt: now + CACHE_TTL_MS };
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
  return mutateVisualIndexSnapshot(transform).then((snapshot) => snapshot.value);
}

/** Return the ETag of the exact visual bytes observed or committed, for the repair checkpoint. */
export function mutateVisualIndexSnapshot(
  transform: (
    current: StyleGalleryVisualIndex,
    etag: string | null,
  ) => StyleGalleryVisualIndex | Promise<StyleGalleryVisualIndex>,
) {
  const operation = async () => {
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      // Even an expired snapshot is safe for an optimistic write: disagreement forces a fresh read and replay.
      const cached = attempt === 1 && visualIndexCache?.etag ? visualIndexCache : null;
      const snapshot = cached
        ? { text: null, etag: cached.etag }
        : await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_VISUAL_INDEX_KEY, VISUAL_INDEX_TRANSFER_TIMEOUT_MS);
      const current = cached
        ? cached.value
        : snapshot.text
          ? styleGalleryVisualIndexSchema.parse(JSON.parse(snapshot.text))
          : createEmptyStyleGalleryVisualIndex();
      if (!cached && snapshot.text && !snapshot.etag) throw new Error('HF did not return an ETag for the visual index.');
      const transformed = await transform(current, snapshot.etag);
      if (transformed === current && snapshot.etag) {
        // A stale local no-op must replay just like a failed conditional write.
        if (!cached || (await getStyleGalleryObjectEtag(STYLE_GALLERY_VISUAL_INDEX_KEY)) === snapshot.etag)
          return { value: current, etag: snapshot.etag };
        continue;
      }
      const next = styleGalleryVisualIndexSchema.parse(transformed);
      // 视觉索引包含定长向量，缩进只会增加 HF 传输与冷实例解析成本，不提供运行时价值。
      const body = new TextEncoder().encode(JSON.stringify(next));
      try {
        const etag = await putStyleGalleryObject(
          STYLE_GALLERY_VISUAL_INDEX_KEY,
          body,
          'application/json; charset=utf-8',
          snapshot.etag ? { ifMatch: snapshot.etag } : { ifNoneMatch: '*' },
        );
        visualIndexCache = { value: next, etag, expiresAt: Date.now() + CACHE_TTL_MS };
        return { value: next, etag };
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
export function invalidateStyleGalleryStoreCache(options: { revalidateCatalog?: boolean } = {}): void {
  invalidateCatalogRead();
  // A confirmed catalog PUT supplies both the parsed body and its ETag. Expire it for
  // ordinary readers, but let conditional readers reuse it after a matching HEAD.
  if (options.revalidateCatalog && catalogCache?.etag) catalogCache.expiresAt = 0;
  else catalogCache = null;
  promptSearchIndexCache = null;
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
