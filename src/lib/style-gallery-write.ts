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
  StyleGalleryExampleIndexGroup,
} from '@/types/style-gallery';

const ASSET_VALIDATION_CONCURRENCY = 16;
const ITEM_WRITE_CONCURRENCY = 16;
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
 * 流程固定为：并发校验图片对象 -> 并发保存详情快照与详情对象 -> 每批只更新一次 catalog -> 重新读取验证。
 * 普通导入不会读写示例索引，只有草稿变更需要移除索引分组时才触碰它；任一步失败都会尽力恢复旧详情和索引。
 * 单批详情 I/O 随批次 item 数线性增长；catalog 只重写一次，当前全量日期排序为 O(catalog item 数 log catalog item 数)。
 * 该路径不会为每个 item 重写一次全局 catalog，因此不会因批量导入退化成重复的全表写入。
 * 生成示例必须走专用 endpoint，避免导入覆盖已有 Sub-gallery。
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

    const previousCatalog = await getStyleGalleryCatalog({ fresh: true });
    const nextBySlug = new Map(previousCatalog.items.map((item) => [item.slug, item]));
    const slugByHash = new Map(previousCatalog.items.map((item) => [item.imageHash, item.slug]));
    const previousItemBodies = new Map<string, string | null>();
    const writtenItems: StoredStyleGalleryItem[] = [];
    const attemptedIndexGroups = new Map<string, StyleGalleryExampleIndexGroup | null>();
    let previousIndex: StyleGalleryExampleIndex | null = null;
    let skippedDuplicates = 0;

    try {
      const reservedSlugHashes = new Map(previousCatalog.items.map((item) => [item.slug, item.imageHash]));
      const candidates: Array<{ slug: string; submittedItem: StoredStyleGalleryItem }> = [];
      for (const submittedItem of items) {
        const existingSlug = slugByHash.get(submittedItem.imageHash);
        if (existingSlug && mode === 'create') {
          skippedDuplicates += 1;
          continue;
        }

        const slug = existingSlug ?? submittedItem.slug;
        const reservedHash = reservedSlugHashes.get(slug);
        if (reservedHash && reservedHash !== submittedItem.imageHash) {
          throw new StyleGalleryClientError(`Style gallery slug collision: ${slug}`, 409);
        }
        reservedSlugHashes.set(slug, submittedItem.imageHash);
        candidates.push({ slug, submittedItem });
      }

      const preparedWrites = await mapWithConcurrency(candidates, ITEM_WRITE_CONCURRENCY, async (candidate) => {
        const itemKey = getStyleGalleryItemKey(candidate.slug);
        const previousBody = await getStyleGalleryObjectText(itemKey);
        const existingItem = previousBody ? styleGalleryItemSchema.parse(JSON.parse(previousBody)) : null;
        const item = {
          ...candidate.submittedItem,
          slug: candidate.slug,
          examples: existingItem?.examples ?? [],
        };
        return { item, previousBody };
      });

      for (const { item, previousBody } of preparedWrites) previousItemBodies.set(item.slug, previousBody);
      const writeOutcomes = await mapWithConcurrency(preparedWrites, ITEM_WRITE_CONCURRENCY, async ({ item }) => {
        try {
          await putStoredStyleGalleryItem(item);
          return null;
        } catch (error) {
          return error;
        }
      });
      const writeErrors = writeOutcomes.filter((error) => error !== null);
      if (writeErrors.length) throw new AggregateError(writeErrors, 'Failed to write one or more style gallery items.');

      for (const { item } of preparedWrites) {
        writtenItems.push(item);

        if (item.draft) {
          nextBySlug.delete(item.slug);
        } else {
          nextBySlug.set(item.slug, toStyleGalleryCatalogItem(item));
          slugByHash.set(item.imageHash, item.slug);
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
        for (const item of writtenItems) {
          if (!activeSlugs.has(item.slug)) attemptedIndexGroups.set(item.slug, null);
        }
        if (attemptedIndexGroups.size) previousIndex = await getStyleGalleryExampleIndex({ fresh: true });
        await putStyleGalleryCatalog(nextCatalog);
        if (attemptedIndexGroups.size) {
          await mutateStyleGalleryExampleIndex((current) => ({
            version: 2,
            updatedAt: nextCatalog.updatedAt,
            groups: current.groups.filter((group) => activeSlugs.has(group.sourceSlug)),
          }));
        }
        invalidateStyleGalleryStoreCache();
        const savedCatalog = await getStyleGalleryCatalog({ fresh: true });
        assertCatalogContains(
          savedCatalog,
          writtenItems.filter((item) => !item.draft),
        );
      }

      return { items: writtenItems, written: writtenItems.length, skippedDuplicates };
    } catch (error) {
      const rollbackErrors = await rollbackMetadata(previousCatalog, previousIndex, previousItemBodies, attemptedIndexGroups);
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
    const previousGroup = previousIndex.groups.find((group) => group.sourceSlug === slug);
    const attemptedGroup = examples.length ? toStyleGalleryExampleIndexGroup(slug, examples, previousGroup) : null;

    try {
      await Promise.all([putStoredStyleGalleryItem(item), putStyleGalleryCatalog(catalog)]);
      const index = await mutateStyleGalleryExampleIndex((current) => {
        const currentGroup = current.groups.find((group) => group.sourceSlug === slug);
        const groups = current.groups.filter((group) => group.sourceSlug !== slug);
        if (examples.length) groups.push(toStyleGalleryExampleIndexGroup(slug, examples, currentGroup));
        return { version: 2, updatedAt, groups };
      });
      return { item, index };
    } catch (error) {
      const rollback = await Promise.allSettled([
        putStoredStyleGalleryItem(previousItem),
        putStyleGalleryCatalog(previousCatalog),
        restoreStyleGalleryExampleIndexStructure(previousIndex, new Map([[slug, attemptedGroup]])),
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
  previousIndex: StyleGalleryExampleIndex | null,
  previousItemBodies: Map<string, string | null>,
  attemptedIndexGroups: ReadonlyMap<string, StyleGalleryExampleIndexGroup | null>,
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
  if (previousIndex && attemptedIndexGroups.size) {
    try {
      await restoreStyleGalleryExampleIndexStructure(previousIndex, attemptedIndexGroups);
    } catch (error) {
      errors.push(error);
    }
  }
  invalidateStyleGalleryStoreCache();
  return errors;
}

/**
 * 对 previous / attempted / current 做条件回滚。只有 current 仍等于本次 attempted 结构时才恢复 previous；
 * 如果同一 slug 已出现其他实例的结构变更，则保留 current。结构比较忽略 likedBy，恢复时再合并最新点赞。
 */
export function mergeStyleGalleryExampleIndexRollback(
  current: StyleGalleryExampleIndex,
  previous: StyleGalleryExampleIndex,
  attemptedBySlug: ReadonlyMap<string, StyleGalleryExampleIndexGroup | null>,
): StyleGalleryExampleIndex['groups'] {
  const currentBySlug = new Map(current.groups.map((group) => [group.sourceSlug, group]));
  const previousBySlug = new Map(previous.groups.map((group) => [group.sourceSlug, group]));
  const handledSlugs = new Set<string>();
  const merged = current.groups.flatMap((group) => {
    if (!attemptedBySlug.has(group.sourceSlug)) return [group];
    handledSlugs.add(group.sourceSlug);
    const attempted = attemptedBySlug.get(group.sourceSlug) ?? null;
    const previousGroup = previousBySlug.get(group.sourceSlug);
    const restored = rollbackGroupStructure(group, previousGroup ?? null, attempted);
    return restored ? [restored] : [];
  });

  for (const [slug, attempted] of attemptedBySlug) {
    if (handledSlugs.has(slug) || currentBySlug.has(slug) || attempted !== null) continue;
    const previousGroup = previousBySlug.get(slug);
    if (previousGroup) merged.push(previousGroup);
  }
  return merged;
}

async function restoreStyleGalleryExampleIndexStructure(
  previous: StyleGalleryExampleIndex,
  attemptedBySlug: ReadonlyMap<string, StyleGalleryExampleIndexGroup | null>,
): Promise<void> {
  await mutateStyleGalleryExampleIndex((current) => {
    return {
      version: 2,
      updatedAt: new Date().toISOString(),
      groups: mergeStyleGalleryExampleIndexRollback(current, previous, attemptedBySlug),
    };
  });
}

function rollbackGroupStructure(
  current: StyleGalleryExampleIndexGroup | null,
  previous: StyleGalleryExampleIndexGroup | null,
  attempted: StyleGalleryExampleIndexGroup | null,
): StyleGalleryExampleIndexGroup | null {
  if (!current || !attempted) return current;
  if (hasSameGroupStructure(current, attempted)) return previous ? restoreGroupWithCurrentLikes(previous, current) : null;

  const previousById = new Map(previous?.examples.map((example) => [example.id, example]));
  const attemptedById = new Map(attempted.examples.map((example) => [example.id, example]));
  const currentIds = new Set(current.examples.map((example) => example.id));
  const examples = current.examples.flatMap((example) => {
    const attemptedExample = attemptedById.get(example.id);
    if (!attemptedExample || !hasSameEntryStructure(example, attemptedExample)) return [example];
    const previousExample = previousById.get(example.id);
    return previousExample ? [{ ...previousExample, likedBy: example.likedBy }] : [];
  });

  // attempted 中缺失且 current 中仍缺失的旧记录属于本次删除，需要恢复；并发重新加入的版本已经在上面保留。
  for (const previousExample of previous?.examples ?? []) {
    if (!attemptedById.has(previousExample.id) && !currentIds.has(previousExample.id)) examples.push(previousExample);
  }
  return examples.length ? { sourceSlug: current.sourceSlug, examples } : null;
}

function hasSameGroupStructure(left: StyleGalleryExampleIndexGroup, right: StyleGalleryExampleIndexGroup): boolean {
  return (
    left.sourceSlug === right.sourceSlug &&
    left.examples.length === right.examples.length &&
    left.examples.every((example, index) => {
      const candidate = right.examples[index];
      return candidate !== undefined && hasSameEntryStructure(example, candidate);
    })
  );
}

function hasSameEntryStructure(
  left: StyleGalleryExampleIndexGroup['examples'][number],
  right: StyleGalleryExampleIndexGroup['examples'][number],
): boolean {
  return (
    left.id === right.id &&
    left.src === right.src &&
    left.model === right.model &&
    left.note === right.note &&
    left.uploadedAt === right.uploadedAt
  );
}

function restoreGroupWithCurrentLikes(
  previous: StyleGalleryExampleIndexGroup,
  current: StyleGalleryExampleIndexGroup,
): StyleGalleryExampleIndexGroup {
  const currentById = new Map(current.examples.map((example) => [example.id, example]));
  return {
    ...previous,
    examples: previous.examples.map((example) => ({
      ...example,
      likedBy: currentById.get(example.id)?.likedBy ?? example.likedBy,
    })),
  };
}
