import { randomUUID } from 'node:crypto';
import { invalidateByTag } from '@vercel/functions';
import { getStyleGalleryObjectTextSnapshot, putStyleGalleryObject, StyleGalleryObjectConflictError } from './hf-s3-presign';
import { StyleGalleryClientError } from './style-gallery-errors';
import { buildGalleryMerge, galleryMergeRevision } from './style-gallery-merge-plan';
import type { GalleryMergePreview, GalleryMergeSelection } from './style-gallery-merge-types';
import { invalidateStyleGalleryPublicCache } from './style-gallery-public-cache';
import {
  styleGalleryCatalogSchema,
  styleGalleryExampleIndexSchema,
  styleGalleryItemSchema,
  styleGalleryPromptSearchIndexSchema,
  styleGalleryVisualIndexSchema,
  toStyleGalleryCatalogItem,
  toStyleGalleryPromptSearchEntry,
} from './style-gallery-schema';
import {
  getStyleGalleryItemKey,
  invalidateStyleGalleryStoreCache,
  STYLE_GALLERY_CATALOG_KEY,
  STYLE_GALLERY_EXAMPLE_INDEX_KEY,
  STYLE_GALLERY_PROMPT_SEARCH_INDEX_KEY,
  STYLE_GALLERY_VISUAL_INDEX_KEY,
} from './style-gallery-store';
import { galleryTagsSchema, STYLE_GALLERY_TAG_CACHE_TAG, STYLE_GALLERY_TAG_KEY } from './style-gallery-tag-store';
import type { StyleGalleryTagIndex } from './style-gallery-tags';
import { compactStyleGalleryVisualIndex } from './style-gallery-visual-index';
import { serializeStyleGalleryWrite } from './style-gallery-write';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
type Snapshot = Awaited<ReturnType<typeof getStyleGalleryObjectTextSnapshot>>;
const conflict = () => new StyleGalleryClientError('Cards changed. Reload the comparison before merging.', 409);

/** Authenticated, on-demand reads of exactly two details. No additional work is added to list requests. */
async function readMergeCards(hashes: [string, string]) {
  const catalogSnapshot = await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_CATALOG_KEY);
  if (!catalogSnapshot.text || !catalogSnapshot.etag) throw new Error('Catalog snapshot unavailable.');
  const catalog = styleGalleryCatalogSchema.parse(JSON.parse(catalogSnapshot.text));
  const entries = hashes.map((hash) => {
    const matches = catalog.items.filter((item) => item.imageHash.toLowerCase().startsWith(hash.toLowerCase()));
    if (matches.length !== 1) throw new StyleGalleryClientError('Hash must identify exactly one existing card.', 400);
    return matches[0];
  });
  if (entries[0].slug === entries[1].slug) throw new StyleGalleryClientError('Choose two different cards.', 400);
  const [left, right, tagsSnapshot, indexSnapshot] = await Promise.all([
    getStyleGalleryObjectTextSnapshot(getStyleGalleryItemKey(entries[0].slug)),
    getStyleGalleryObjectTextSnapshot(getStyleGalleryItemKey(entries[1].slug)),
    getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_TAG_KEY),
    getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_EXAMPLE_INDEX_KEY),
  ]);
  if (!left.text || !right.text || !left.etag || !right.etag) throw conflict();
  const items = [
    styleGalleryItemSchema.parse(JSON.parse(left.text)),
    styleGalleryItemSchema.parse(JSON.parse(right.text)),
  ] as const;
  const tags: StyleGalleryTagIndex = tagsSnapshot.text ? JSON.parse(tagsSnapshot.text) : { version: 1, items: {} };
  const index = styleGalleryExampleIndexSchema.parse(
    indexSnapshot.text ? JSON.parse(indexSnapshot.text) : { version: 2, updatedAt: new Date(0).toISOString(), groups: [] },
  );
  const cards = items.map((item) => ({
    item,
    tags: tags.items[item.slug] ?? [],
    revision: galleryMergeRevision(item, tags.items[item.slug] ?? [], index),
    likeCounts: Object.fromEntries(
      index.groups
        .find((group) => group.sourceSlug === item.slug)
        ?.examples.map((example) => [example.id, example.likedBy.length]) ?? [],
    ),
  })) as GalleryMergePreview['cards'];
  return { cards, catalog, catalogSnapshot, itemSnapshots: [left, right], tags, tagsSnapshot, index, indexSnapshot };
}

export async function previewGalleryMerge(hashes: [string, string]): Promise<GalleryMergePreview> {
  const { cards } = await readMergeCards(hashes);
  return { cards };
}

/** Conditional writes protect every shared object; a failed publication restores only versions we still own. */
export async function mergeGalleryCards(hashes: [string, string], revisions: [string, string], choice: GalleryMergeSelection) {
  return serializeStyleGalleryWrite(async () => {
    const state = await readMergeCards(hashes);
    if (state.cards.some((card, side) => card.revision !== revisions[side])) throw conflict();
    const selectedTags = galleryTagsSchema.parse(choice.tags);
    const vocabulary = new Set(state.cards.flatMap((card) => card.tags));
    if (selectedTags.some((tag) => !vocabulary.has(tag)))
      throw new StyleGalleryClientError('Choose tags from these cards.', 400);
    const { item, removed, group, remappedIds } = buildGalleryMerge(
      [state.cards[0].item, state.cards[1].item],
      choice,
      state.index,
    );
    const [searchSnapshot, visualSnapshot] = await Promise.all([
      getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_PROMPT_SEARCH_INDEX_KEY),
      getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_VISUAL_INDEX_KEY, 60_000),
    ]);
    if (!searchSnapshot.text || !searchSnapshot.etag) throw new Error('Search snapshot unavailable.');
    const search = styleGalleryPromptSearchIndexSchema.parse(JSON.parse(searchSnapshot.text));
    delete search.entries[removed.slug];
    search.entries[item.slug] = toStyleGalleryPromptSearchEntry(item);
    search.updatedAt = item.updated ?? item.date;
    const tags: StyleGalleryTagIndex = { version: 1, items: { ...state.tags.items } };
    delete tags.items[removed.slug];
    delete tags.items[item.slug];
    if (selectedTags.length) tags.items[item.slug] = selectedTags;
    const index = {
      ...state.index,
      updatedAt: item.updated ?? item.date,
      groups: [...state.index.groups.filter((entry) => ![item.slug, removed.slug].includes(entry.sourceSlug)), group],
    };
    const catalog = {
      ...state.catalog,
      updatedAt: item.updated ?? item.date,
      items: state.catalog.items
        .filter((entry) => ![item.slug, removed.slug].includes(entry.slug))
        .concat(toStyleGalleryCatalogItem(item))
        .sort((a, b) => b.date.localeCompare(a.date)),
    };
    const writes: { key: string; before: Snapshot; value: unknown; empty?: unknown }[] = [
      { key: getStyleGalleryItemKey(item.slug), before: state.itemSnapshots[choice.keep], value: item },
      { key: STYLE_GALLERY_EXAMPLE_INDEX_KEY, before: state.indexSnapshot, value: index, empty: state.index },
      { key: STYLE_GALLERY_TAG_KEY, before: state.tagsSnapshot, value: tags, empty: state.tags },
      { key: STYLE_GALLERY_PROMPT_SEARCH_INDEX_KEY, before: searchSnapshot, value: search },
    ];
    if (visualSnapshot.text) {
      const visual = styleGalleryVisualIndexSchema.parse(JSON.parse(visualSnapshot.text));
      const seen = new Set<string>();
      visual.records = visual.records.flatMap((record) => {
        if (![item.slug, removed.slug].includes(record.sourceSlug)) return [record];
        if (record.kind === 'source') return record.sourceSlug === item.slug ? [record] : [];
        const imageId = remappedIds.get(record.imageId);
        if (!imageId || seen.has(imageId)) return [];
        seen.add(imageId);
        return [{ ...record, sourceSlug: item.slug, imageId }];
      });
      visual.updatedAt = item.updated ?? item.date;
      writes.push({
        key: STYLE_GALLERY_VISUAL_INDEX_KEY,
        before: visualSnapshot,
        value: compactStyleGalleryVisualIndex(visual),
      });
    }
    // Replace the retired detail with a tiny redirect; raw assets remain untouched and may be shared.
    writes.push({
      key: getStyleGalleryItemKey(removed.slug),
      before: state.itemSnapshots[choice.keep === 0 ? 1 : 0],
      value: { mergedInto: item.slug },
    });
    // Catalog publishes last, after details and all derived indexes are ready.
    writes.push({ key: STYLE_GALLERY_CATALOG_KEY, before: state.catalogSnapshot, value: catalog });
    const mergeId = randomUUID();
    // A private recovery record keeps the two original details and votes without duplicating global indexes.
    await putStyleGalleryObject(
      `merge-backups/${mergeId}.json`,
      encode({
        items: state.cards.map((card) => card.item),
        tags: state.cards.map((card) => card.tags),
        groups: state.index.groups.filter((entry) => state.cards.some((card) => card.item.slug === entry.sourceSlug)),
        choice,
      }),
      'application/json',
      { ifNoneMatch: '*' },
    );
    const committed: { write: (typeof writes)[number]; etag: string }[] = [];
    try {
      for (const write of writes) {
        if (write.before.text && !write.before.etag) throw new Error('Missing conditional-write ETag.');
        const body = JSON.stringify(write.value);
        let etag: string | null;
        try {
          etag = await putStyleGalleryObject(
            write.key,
            new TextEncoder().encode(body),
            'application/json',
            write.before.etag ? { ifMatch: write.before.etag } : { ifNoneMatch: '*' },
          );
          if (!etag) throw new Error(`Missing publication ETag (${mergeId}).`);
        } catch (error) {
          // A lost PUT response can become a 412 on retry. Read back the exact payload before deciding
          // whether this write belongs in the rollback journal; never overwrite a different revision.
          const observed = await getStyleGalleryObjectTextSnapshot(write.key).catch(() => null);
          if (observed?.text !== body || !observed.etag) throw error;
          etag = observed.etag;
        }
        committed.push({ write, etag });
      }
    } catch (error) {
      const failed: unknown[] = [];
      for (const { write, etag } of committed.reverse()) {
        try {
          await putStyleGalleryObject(
            write.key,
            write.before.text ? new TextEncoder().encode(write.before.text) : encode(write.empty),
            'application/json',
            { ifMatch: etag },
          );
        } catch (rollbackError) {
          failed.push(rollbackError);
        }
      }
      if (failed.length) {
        console.error('[style-gallery] Merge recovery required:', mergeId, failed);
        throw new Error(`Merge did not complete; recovery record ${mergeId}.`);
      }
      if (error instanceof StyleGalleryObjectConflictError) throw conflict();
      throw error;
    } finally {
      invalidateStyleGalleryStoreCache();
    }
    await invalidateStyleGalleryPublicCache([item.slug, removed.slug]);
    try {
      await invalidateByTag(STYLE_GALLERY_TAG_CACHE_TAG);
    } catch (error) {
      console.error('[style-gallery] Merge tag cache invalidation failed.', error);
    }
    return { slug: item.slug, removedSlug: removed.slug, mergeId };
  });
}
