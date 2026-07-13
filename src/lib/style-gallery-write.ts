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
  putStoredStyleGalleryItem,
  putStyleGalleryCatalog,
  putStyleGalleryExampleIndex,
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

export function serializeStyleGalleryWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

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
        const nextIndex = {
          ...previousIndex,
          updatedAt: nextCatalog.updatedAt,
          groups: previousIndex.groups.filter((group) => activeSlugs.has(group.sourceSlug)),
        };
        await Promise.all([putStyleGalleryCatalog(nextCatalog), putStyleGalleryExampleIndex(nextIndex)]);
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
    const groups = storedItems.flatMap((item) => {
      return item.examples.length ? [toStyleGalleryExampleIndexGroup(item.slug, item.examples)] : [];
    });
    const indexChanged = JSON.stringify(groups) !== JSON.stringify(previousIndex.groups);
    if (updated || indexChanged) {
      const updatedAt = new Date().toISOString();
      await Promise.all([
        putStyleGalleryCatalog({ ...catalog, updatedAt, items }),
        putStyleGalleryExampleIndex({ version: 1, updatedAt, groups }),
      ]);
    }
    return { checked: catalog.items.length, updated };
  });
}

/** Commits one item's examples and both derived indexes as a rollback-capable metadata transaction. */
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
    const groups = previousIndex.groups.filter((group) => group.sourceSlug !== slug);
    if (examples.length) groups.push(toStyleGalleryExampleIndexGroup(slug, examples));
    const index: StyleGalleryExampleIndex = { version: 1, updatedAt, groups };

    try {
      await Promise.all([putStoredStyleGalleryItem(item), putStyleGalleryCatalog(catalog), putStyleGalleryExampleIndex(index)]);
      return { item, index };
    } catch (error) {
      const rollback = await Promise.allSettled([
        putStoredStyleGalleryItem(previousItem),
        putStyleGalleryCatalog(previousCatalog),
        putStyleGalleryExampleIndex(previousIndex),
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
    await putStyleGalleryExampleIndex(previousIndex);
  } catch (error) {
    errors.push(error);
  }
  invalidateStyleGalleryStoreCache();
  return errors;
}
