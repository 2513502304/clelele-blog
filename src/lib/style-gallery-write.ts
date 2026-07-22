import {
  deleteStyleGalleryObject,
  getStyleGalleryObjectText,
  headStyleGalleryObject,
  putStyleGalleryObject,
} from '@lib/hf-s3-presign';
import { mapWithConcurrency } from '@lib/map-with-concurrency';
import { assertStyleGalleryItemConsistency, getStyleGalleryItemAssetKeys } from '@lib/style-gallery-assets';
import { StyleGalleryClientError } from '@lib/style-gallery-errors';
import { toStyleGalleryExampleIndexGroup } from '@lib/style-gallery-examples';
import { styleGalleryItemSchema, toStyleGalleryCatalogItem } from '@lib/style-gallery-schema';
import {
  getStoredStyleGalleryItem,
  getStyleGalleryCatalog,
  getStyleGalleryExampleIndex,
  getStyleGalleryItemKey,
  invalidateStyleGalleryStoreCache,
  mutateStyleGalleryExampleIndex,
  putStoredStyleGalleryItem,
  putStyleGalleryCatalog,
  STYLE_GALLERY_CATALOG_KEY,
} from '@lib/style-gallery-store';
import type {
  StoredStyleGalleryItem,
  StyleGalleryCatalog,
  StyleGalleryExample,
  StyleGalleryExampleIndex,
} from '@/types/style-gallery';

const ASSET_VALIDATION_CONCURRENCY = 8;
let writeQueue: Promise<unknown> = Promise.resolve();

interface WriteItemsResult {
  items: StoredStyleGalleryItem[];
  written: number;
  skippedDuplicates: number;
}

interface UpdateExamplesResult {
  item: StoredStyleGalleryItem;
  index: StyleGalleryExampleIndex;
}

/**
 * 在单个服务实例内串行执行 Gallery 元数据写入，避免 catalog 的读-改-写相互覆盖。
 * 该队列不是跨实例分布式锁，因此每次操作仍需使用强制刷新、写后校验和回滚保护一致性。
 */
export function serializeStyleGalleryWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * 写入新 item 或更新既有 item。
 *
 * 流程固定为：校验元数据和图片对象存在 -> 保存详情快照 -> 更新 catalog 与示例索引 -> 重新读取验证。
 * 任一步失败都会尽力恢复旧详情和索引；生成示例必须走专用 endpoint，避免导入覆盖已有 Sub-gallery。
 */
export async function writeStyleGalleryItems(
  submittedItems: StoredStyleGalleryItem[],
  mode: 'create' | 'upsert',
): Promise<WriteItemsResult> {
  return serializeStyleGalleryWrite(async () => {
    const byHash = new Map<string, StoredStyleGalleryItem>();
    for (const submittedItem of submittedItems) {
      const item = styleGalleryItemSchema.parse(submittedItem);
      if (item.examples.length) {
        throw new StyleGalleryClientError('Generated examples must be changed through the dedicated examples endpoint.', 400);
      }
      try {
        assertStyleGalleryItemConsistency(item);
      } catch (error) {
        throw new StyleGalleryClientError(
          error instanceof Error ? error.message : 'Invalid style gallery item metadata.',
          400,
          {
            cause: error,
          },
        );
      }
      byHash.set(item.imageHash, item);
    }
    const items = [...byHash.values()];
    await validateItemAssets(items);

    const [previousCatalog, previousIndex] = await Promise.all([
      getStyleGalleryCatalog({ fresh: true }),
      getStyleGalleryExampleIndex({ fresh: true }),
    ]);
    const nextBySlug = new Map(previousCatalog.items.map((item) => [item.slug, item]));
    const slugByHash = new Map(previousCatalog.items.map((item) => [item.imageHash, item.slug]));
    const previousItemBodies = new Map<string, string | null>();
    const writtenItems: StoredStyleGalleryItem[] = [];
    let skippedDuplicates = 0;

    try {
      for (const submittedItem of items) {
        const existingSlug = slugByHash.get(submittedItem.imageHash);
        if (existingSlug && mode === 'create') {
          skippedDuplicates += 1;
          continue;
        }

        const slug = existingSlug ?? submittedItem.slug;
        const slugCollision = nextBySlug.get(slug);
        if (slugCollision && slugCollision.imageHash !== submittedItem.imageHash) {
          throw new StyleGalleryClientError(`Style gallery slug collision: ${slug}`, 409);
        }

        const existingItem = existingSlug ? await getStoredStyleGalleryItem(existingSlug, { fresh: true }) : null;
        const item = {
          ...submittedItem,
          slug,
          examples: existingItem?.examples ?? [],
        };
        const itemKey = getStyleGalleryItemKey(slug);
        previousItemBodies.set(slug, await getStyleGalleryObjectText(itemKey));
        await putStoredStyleGalleryItem(item);
        writtenItems.push(item);

        if (item.draft) {
          nextBySlug.delete(slug);
        } else {
          nextBySlug.set(slug, toStyleGalleryCatalogItem(item));
          slugByHash.set(item.imageHash, slug);
        }
      }

      if (writtenItems.length) {
        const nextCatalog: StyleGalleryCatalog = {
          version: 3,
          updatedAt: new Date().toISOString(),
          tags: previousCatalog.tags,
          modelTargets: previousCatalog.modelTargets,
          items: [...nextBySlug.values()].sort((a, b) => b.date.localeCompare(a.date)),
        };
        const activeSlugs = new Set(nextCatalog.items.map((item) => item.slug));
        await putStyleGalleryCatalog(nextCatalog);
        await mutateStyleGalleryExampleIndex((current) => ({
          version: 2,
          updatedAt: nextCatalog.updatedAt,
          groups: current.groups.filter((group) => activeSlugs.has(group.sourceSlug)),
        }));
        invalidateStyleGalleryStoreCache();
        const savedCatalog = await getStyleGalleryCatalog({ fresh: true });
        assertCatalogContains(
          savedCatalog,
          writtenItems.filter((item) => !item.draft),
        );
      }

      return { items: writtenItems, written: writtenItems.length, skippedDuplicates };
    } catch (error) {
      const rollbackErrors = await rollbackMetadata(previousCatalog, previousIndex, previousItemBodies);
      if (rollbackErrors.length) {
        throw new AggregateError([error, ...rollbackErrors], 'Style gallery write failed and rollback was incomplete.');
      }
      throw error;
    }
  });
}

export async function reconcileStyleGalleryExampleCounts(): Promise<{ checked: number; updated: number }> {
  return serializeStyleGalleryWrite(async () => {
    const [catalog, previousIndex] = await Promise.all([
      getStyleGalleryCatalog({ fresh: true }),
      getStyleGalleryExampleIndex({ fresh: true }),
    ]);
    const storedItems = await mapWithConcurrency(catalog.items, ASSET_VALIDATION_CONCURRENCY, async (item) => {
      const stored = await getStoredStyleGalleryItem(item.slug, { fresh: true });
      if (!stored) throw new Error(`Style gallery item metadata is missing: ${item.slug}`);
      return stored;
    });
    let updated = 0;
    const items = catalog.items.map((item, index) => {
      const exampleCount = storedItems[index].examples.length;
      if (item.exampleCount === exampleCount) return item;
      updated += 1;
      return { ...item, exampleCount };
    });
    const previousBySlug = new Map(previousIndex.groups.map((group) => [group.sourceSlug, group]));
    const groups = storedItems.flatMap((item) =>
      item.examples.length ? [toStyleGalleryExampleIndexGroup(item.slug, item.examples, previousBySlug.get(item.slug))] : [],
    );
    const indexChanged = JSON.stringify(groups) !== JSON.stringify(previousIndex.groups);
    if (updated || indexChanged) {
      const updatedAt = new Date().toISOString();
      await putStyleGalleryCatalog({ ...catalog, updatedAt, items });
      await mutateStyleGalleryExampleIndex((current) => {
        const currentBySlug = new Map(current.groups.map((group) => [group.sourceSlug, group]));
        return {
          version: 2,
          updatedAt,
          groups: storedItems.flatMap((item) =>
            item.examples.length
              ? [toStyleGalleryExampleIndexGroup(item.slug, item.examples, currentBySlug.get(item.slug))]
              : [],
          ),
        };
      });
    }
    return { checked: catalog.items.length, updated };
  });
}

/**
 * 将单个 item 的 examples、catalog 计数和总览索引作为一组可回滚元数据提交。
 * 图片对象的创建/删除在调用方完成；本函数只负责三份元数据视图保持一致。
 */
export async function updateStyleGalleryItemExamples(
  slug: string,
  transform: (examples: StyleGalleryExample[], item: StoredStyleGalleryItem) => StyleGalleryExample[],
): Promise<UpdateExamplesResult> {
  return serializeStyleGalleryWrite(async () => {
    const [previousItem, previousCatalog, previousIndex] = await Promise.all([
      getStoredStyleGalleryItem(slug, { fresh: true }),
      getStyleGalleryCatalog({ fresh: true }),
      getStyleGalleryExampleIndex({ fresh: true }),
    ]);
    if (!previousItem || !previousCatalog.items.some((item) => item.slug === slug)) {
      throw new StyleGalleryClientError('Style gallery item not found.', 404);
    }

    const examples = transform(previousItem.examples, previousItem);
    const updatedAt = new Date().toISOString();
    const item: StoredStyleGalleryItem = { ...previousItem, updated: updatedAt, examples };
    const catalog: StyleGalleryCatalog = {
      ...previousCatalog,
      updatedAt,
      items: previousCatalog.items.map((candidate) =>
        candidate.slug === slug ? { ...candidate, exampleCount: examples.length } : candidate,
      ),
    };
    let index: StyleGalleryExampleIndex | undefined;

    try {
      await Promise.all([putStoredStyleGalleryItem(item), putStyleGalleryCatalog(catalog)]);
      index = await mutateStyleGalleryExampleIndex((current) => {
        const previousGroup = current.groups.find((group) => group.sourceSlug === slug);
        const groups = current.groups.filter((group) => group.sourceSlug !== slug);
        if (examples.length) groups.push(toStyleGalleryExampleIndexGroup(slug, examples, previousGroup));
        return { version: 2, updatedAt, groups };
      });
      return { item, index };
    } catch (error) {
      const rollback = await Promise.allSettled([
        putStoredStyleGalleryItem(previousItem),
        putStyleGalleryCatalog(previousCatalog),
        restoreStyleGalleryExampleIndexStructure(previousIndex),
      ]);
      const rollbackErrors = rollback.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
      if (rollbackErrors.length) {
        throw new AggregateError([error, ...rollbackErrors], 'Example metadata update failed and rollback was incomplete.');
      }
      throw error;
    } finally {
      invalidateStyleGalleryStoreCache();
    }
  });
}

async function validateItemAssets(items: StoredStyleGalleryItem[]): Promise<void> {
  const keys = [...new Set(items.flatMap(getStyleGalleryItemAssetKeys))];
  await mapWithConcurrency(keys, ASSET_VALIDATION_CONCURRENCY, async (key) => {
    if (!(await headStyleGalleryObject(key))) {
      throw new StyleGalleryClientError(`Style gallery asset is missing: ${key}`, 400);
    }
  });
}

/** 写后确认本次提交的所有非草稿 item 已进入 catalog，防止详情成功但列表索引遗漏。 */
function assertCatalogContains(catalog: StyleGalleryCatalog, items: StoredStyleGalleryItem[]): void {
  const savedHashes = new Set(catalog.items.map((item) => item.imageHash));
  const missing = items.filter((item) => !savedHashes.has(item.imageHash));
  if (missing.length) throw new Error(`Catalog verification failed for ${missing.length} style gallery item(s).`);
}

async function rollbackMetadata(
  previousCatalog: StyleGalleryCatalog,
  previousIndex: StyleGalleryExampleIndex,
  previousItemBodies: Map<string, string | null>,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const [slug, body] of previousItemBodies) {
    try {
      const key = getStyleGalleryItemKey(slug);
      if (body === null) {
        await deleteStyleGalleryObject(key);
      } else {
        await putStyleGalleryObject(key, new TextEncoder().encode(body), 'application/json; charset=utf-8');
      }
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    const body = new TextEncoder().encode(`${JSON.stringify(previousCatalog, null, 2)}\n`);
    await putStyleGalleryObject(STYLE_GALLERY_CATALOG_KEY, body, 'application/json; charset=utf-8');
  } catch (error) {
    errors.push(error);
  }
  try {
    await restoreStyleGalleryExampleIndexStructure(previousIndex);
  } catch (error) {
    errors.push(error);
  }
  invalidateStyleGalleryStoreCache();
  return errors;
}

/** 回滚示例结构时保留并发期间已经写入的点赞，避免补偿逻辑反向覆盖新投票。 */
async function restoreStyleGalleryExampleIndexStructure(previous: StyleGalleryExampleIndex): Promise<void> {
  await mutateStyleGalleryExampleIndex((current) => {
    const currentById = new Map(current.groups.flatMap((group) => group.examples.map((example) => [example.id, example])));
    return {
      version: 2,
      updatedAt: new Date().toISOString(),
      groups: previous.groups.map((group) => ({
        ...group,
        examples: group.examples.map((example) => ({
          ...example,
          likedBy: currentById.get(example.id)?.likedBy ?? example.likedBy,
        })),
      })),
    };
  });
}
