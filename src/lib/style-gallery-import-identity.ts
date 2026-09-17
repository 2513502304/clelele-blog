import { createHash, randomUUID } from 'node:crypto';
import type { StoredStyleGalleryItem } from '@/types/style-gallery';
import {
  getStyleGalleryObjectTextSnapshot,
  headStyleGalleryObject,
  putStyleGalleryObject,
  StyleGalleryObjectConflictError,
} from './hf-s3-presign';
import { mapWithConcurrency } from './map-with-concurrency';
import { assertStyleGalleryItemConsistency, getStyleGalleryItemAssetKeys } from './style-gallery-assets';
import { StyleGalleryClientError } from './style-gallery-errors';
import { invalidateStyleGalleryPublicCache } from './style-gallery-public-cache';
import {
  styleGalleryCatalogSchema,
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
  STYLE_GALLERY_PROMPT_SEARCH_INDEX_KEY,
  STYLE_GALLERY_VISUAL_INDEX_KEY,
} from './style-gallery-store';
import { compactStyleGalleryVisualIndex, replaceStyleGallerySourceVisualRecords } from './style-gallery-visual-index';
import type { StyleGalleryVisualRecordInput } from './style-gallery-visual-types';
import { serializeStyleGalleryWrite } from './style-gallery-write';

// Private import-only aliases: no list payload, SSR read, local attachment path or session text.
export const IMPORT_IDENTITY_KEY = 'metadata/import-image-identities-v1.json';
type Snapshot = Awaited<ReturnType<typeof getStyleGalleryObjectTextSnapshot>>;
type Aliases = { version: 1; hashes: Record<string, string> };
export type ImportIdentityQuery = { hashes: string[]; legacySlug: string };
const revision = (text: string) => createHash('sha256').update(text).digest('hex');
const conflict = (message: string) => new StyleGalleryClientError(message, 409);

async function readAliases() {
  const snapshot = await getStyleGalleryObjectTextSnapshot(IMPORT_IDENTITY_KEY);
  const value: Aliases = snapshot.text ? JSON.parse(snapshot.text) : { version: 1, hashes: {} };
  if (value.version !== 1 || !value.hashes || typeof value.hashes !== 'object')
    throw new Error('Invalid import identity index.');
  return { snapshot, value };
}

/** Follow explicit merge redirects only; never infer identity from a similar image or prompt. */
async function readIdentity(
  slug: string,
  visited = new Set<string>(),
): Promise<{ item: StoredStyleGalleryItem; snapshot: Snapshot & { text: string; etag: string } } | null> {
  if (!/^[a-z0-9-]{1,160}$/i.test(slug) || visited.has(slug) || visited.size >= 32)
    throw conflict('Invalid image identity redirect.');
  visited.add(slug);
  const snapshot = await getStyleGalleryObjectTextSnapshot(getStyleGalleryItemKey(slug));
  if (!snapshot.text) return null;
  const parsed = JSON.parse(snapshot.text);
  if (typeof parsed.mergedInto === 'string') return readIdentity(parsed.mergedInto, visited);
  const item = styleGalleryItemSchema.parse(parsed);
  if (item.slug !== slug || !snapshot.etag) throw conflict('Image identity changed. Retry the import.');
  return { item, snapshot: { ...snapshot, text: snapshot.text, etag: snapshot.etag } };
}

/** Bounded, authenticated resolution also recognizes historical cards retired by the merge editor. */
export async function resolveImportIdentities(queries: ImportIdentityQuery[]) {
  const [catalogSnapshot, aliases] = await Promise.all([
    getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_CATALOG_KEY),
    readAliases(),
  ]);
  const catalog = styleGalleryCatalogSchema.parse(JSON.parse(catalogSnapshot.text ?? 'null'));
  const byHash = new Map(catalog.items.map((item) => [item.imageHash, item.slug]));
  const active = new Set(catalog.items.map((item) => item.slug));
  const memo = new Map<string, ReturnType<typeof readIdentity>>();
  const read = (slug: string) => {
    const pending = memo.get(slug) ?? readIdentity(slug);
    memo.set(slug, pending);
    return pending;
  };
  return mapWithConcurrency(queries, 5, async (query) => {
    const slugs = [
      ...new Set(
        query.hashes
          .flatMap((hash) => [aliases.value.hashes[hash], byHash.get(hash)])
          .filter((slug): slug is string => Boolean(slug)),
      ),
    ];
    // This predictable old URL is the only historical fallback; no full detail scan.
    if (!slugs.length) slugs.push(query.legacySlug);
    const matches = (await Promise.all(slugs.map(read))).filter((entry): entry is NonNullable<typeof entry> =>
      Boolean(entry && active.has(entry.item.slug)),
    );
    const unique = new Map(matches.map((entry) => [entry.item.slug, entry]));
    if (unique.size > 1)
      throw conflict(
        `Image versions already belong to separate cards (${[...unique.keys()].join(', ')}). Merge those cards explicitly before importing.`,
      );
    const match = [...unique.values()][0];
    return match ? { item: match.item, revision: revision(match.snapshot.text) } : null;
  });
}

/** Reserve confirmed aliases before publication; missing targets stay private until catalog publication. */
export async function rememberImportIdentities(bindings: { hashes: string[]; slug: string; expectedHash?: string }[]) {
  return serializeStyleGalleryWrite(async () => {
    const aliases = await readAliases();
    const memo = new Map<string, Awaited<ReturnType<typeof readIdentity>>>();
    const read = async (slug: string) => {
      if (!memo.has(slug)) memo.set(slug, await readIdentity(slug));
      return memo.get(slug);
    };
    let changed = 0;
    for (const binding of bindings) {
      const target = await read(binding.slug);
      const targetSlug = target?.item.slug ?? binding.slug;
      if (
        !target &&
        (!binding.expectedHash ||
          !binding.hashes.includes(binding.expectedHash) ||
          !binding.slug.endsWith(`-${binding.expectedHash.slice(0, 12)}`))
      )
        throw conflict('Cannot bind an unverified pending image.');
      if (target && binding.expectedHash && target.item.imageHash !== binding.expectedHash)
        throw conflict('Image identity changed before publication.');
      for (const hash of binding.hashes) {
        const oldSlug = aliases.value.hashes[hash];
        const oldTarget = oldSlug ? await read(oldSlug) : null;
        if (oldTarget && oldTarget.item.slug !== targetSlug) throw conflict('Image alias belongs to another card.');
        if (oldSlug !== targetSlug) {
          aliases.value.hashes[hash] = targetSlug;
          changed++;
        }
      }
    }
    if (changed)
      await putStyleGalleryObject(
        IMPORT_IDENTITY_KEY,
        new TextEncoder().encode(JSON.stringify(aliases.value)),
        'application/json',
        aliases.snapshot.etag ? { ifMatch: aliases.snapshot.etag } : { ifNoneMatch: '*' },
      );
    return { changed };
  });
}

/**
 * Replace source bytes explicitly while retaining the stable URL and all independently edited data.
 * Catalog hash/title/images change, but tags, example IDs/votes and per-variant original prompts stay intact.
 * Every object uses CAS; catalog publishes last. Old assets remain for shared references and recovery.
 */
export type ImportImageReplacement = {
  slug: string;
  revision: string;
  item: StoredStyleGalleryItem;
  visualRecords: StyleGalleryVisualRecordInput[];
  hashes: string[];
};

export async function replaceImportImages(
  slug: string,
  expectedRevision: string,
  replacement: StoredStyleGalleryItem,
  records: StyleGalleryVisualRecordInput[],
  hashes: string[],
) {
  const result = await replaceImportImageBatch([
    { slug, revision: expectedRevision, item: replacement, visualRecords: records, hashes },
  ]);
  return { item: result.items[0], changed: result.changed > 0, recoveryId: result.recoveryId };
}

/** One catalog/search/visual publication per batch, rather than one full-index rewrite per image. */
export async function replaceImportImageBatch(jobs: ImportImageReplacement[]) {
  return serializeStyleGalleryWrite(async () => {
    if (
      new Set(jobs.map((job) => job.slug)).size !== jobs.length ||
      new Set(jobs.map((job) => job.item.imageHash)).size !== jobs.length
    )
      throw conflict('Duplicate replacement target.');
    const changes = await mapWithConcurrency(jobs, 5, async (job) => {
      const { slug, revision: expectedRevision, item: replacement, visualRecords: records } = job;
      const current = await readIdentity(slug);
      if (!current || current.item.slug !== slug) throw conflict('Card changed. Rerun to review current image identity.');
      // A whole-request response may be lost after catalog publication. Same-target retries are read-only.
      if (current.item.imageHash !== replacement.imageHash && revision(current.snapshot.text) !== expectedRevision)
        throw conflict('Card changed. Rerun to review current image identity.');
      const previous = current.item;
      if (previous.images.length !== replacement.images.length)
        throw conflict('Replacement must preserve image count and order.');
      if (previous.imageHash === replacement.imageHash)
        return { previous, item: previous, snapshot: current.snapshot, job, changed: false };
      const item = styleGalleryItemSchema.parse({
        ...previous,
        imageHash: replacement.imageHash,
        images: replacement.images,
        sourceImage: replacement.sourceImage,
        sourceImageAlt: replacement.sourceImageAlt,
        title:
          previous.title === `Style Prompt ${previous.imageHash.slice(0, 12)}`
            ? `Style Prompt ${replacement.imageHash.slice(0, 12)}`
            : previous.title,
        updated: new Date().toISOString(),
      });
      assertStyleGalleryItemConsistency(item);
      const expected = new Set(item.images.map((image) => image.imageHash));
      if (
        records.length !== expected.size ||
        records.some(
          (record) =>
            record.kind !== 'source' ||
            record.sourceSlug !== slug ||
            record.imageId !== record.feature.imageHash ||
            !expected.delete(record.imageId),
        ) ||
        expected.size
      )
        throw new StyleGalleryClientError('Replacement features do not match source images.', 400);
      for (const key of getStyleGalleryItemAssetKeys(item))
        if (!(await headStyleGalleryObject(key))) throw new StyleGalleryClientError('Replacement asset is missing.', 400);
      return { previous, item, snapshot: current.snapshot, job, changed: true };
    });
    const changed = changes.filter((change) => change.changed);
    if (!changed.length) return { items: changes.map((change) => change.item), changed: 0 };
    const [catalogSnapshot, searchSnapshot, visualSnapshot, aliases] = await Promise.all([
      getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_CATALOG_KEY),
      getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_PROMPT_SEARCH_INDEX_KEY),
      getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_VISUAL_INDEX_KEY, 60_000),
      readAliases(),
    ]);
    const catalog = styleGalleryCatalogSchema.parse(JSON.parse(catalogSnapshot.text ?? 'null'));
    const search = styleGalleryPromptSearchIndexSchema.parse(JSON.parse(searchSnapshot.text ?? 'null'));
    for (const {
      previous,
      item,
      job: { slug, hashes },
    } of changed) {
      if (!catalog.items.some((entry) => entry.slug === slug && entry.imageHash === previous.imageHash))
        throw conflict('Card is no longer active.');
      if (catalog.items.some((entry) => entry.slug !== slug && entry.imageHash === item.imageHash))
        throw conflict('Original image already has a card. Merge the cards before retrying.');
      for (const hash of [...hashes, previous.imageHash, item.imageHash]) {
        const bound = aliases.value.hashes[hash];
        const boundItem = bound && bound !== slug ? await readIdentity(bound) : null;
        if (boundItem && boundItem.item.slug !== slug) throw conflict('Image alias belongs to another card.');
        aliases.value.hashes[hash] = slug;
      }
      search.entries[slug] = toStyleGalleryPromptSearchEntry(item);
      search.updatedAt = item.updated ?? item.date;
      catalog.items = catalog.items.map((entry) => (entry.slug === slug ? toStyleGalleryCatalogItem(item) : entry));
      catalog.updatedAt = item.updated ?? item.date;
    }
    const visual = styleGalleryVisualIndexSchema.parse(JSON.parse(visualSnapshot.text ?? 'null'));
    const writes: { key: string; before: Snapshot; value: unknown; empty?: unknown }[] = [
      ...changed.map(({ item, snapshot }) => ({ key: getStyleGalleryItemKey(item.slug), before: snapshot, value: item })),
      { key: STYLE_GALLERY_PROMPT_SEARCH_INDEX_KEY, before: searchSnapshot, value: search },
      {
        key: STYLE_GALLERY_VISUAL_INDEX_KEY,
        before: visualSnapshot,
        value: compactStyleGalleryVisualIndex(
          replaceStyleGallerySourceVisualRecords(
            visual,
            new Set(changed.map(({ item }) => item.slug)),
            changed.flatMap(({ job }) => job.visualRecords),
          ),
        ),
      },
      { key: IMPORT_IDENTITY_KEY, before: aliases.snapshot, value: aliases.value, empty: { version: 1, hashes: {} } },
      { key: STYLE_GALLERY_CATALOG_KEY, before: catalogSnapshot, value: catalog },
    ];
    const recoveryId = randomUUID();
    await putStyleGalleryObject(
      `import-backups/${recoveryId}.json`,
      new TextEncoder().encode(
        JSON.stringify({
          changes: changed.map(({ previous, item, job }) => ({ item: previous, replacement: item, aliases: job.hashes })),
        }),
      ),
      'application/json',
      { ifNoneMatch: '*' },
    );
    const committed: { write: (typeof writes)[number]; etag: string }[] = [];
    try {
      for (const write of writes) {
        if (write.before.text && !write.before.etag) throw new Error('Missing snapshot ETag.');
        const body = JSON.stringify(write.value);
        let etag: string | null;
        try {
          etag = await putStyleGalleryObject(
            write.key,
            new TextEncoder().encode(body),
            'application/json',
            write.before.etag ? { ifMatch: write.before.etag } : { ifNoneMatch: '*' },
          );
          if (!etag) throw new Error('Missing publication ETag.');
        } catch (error) {
          const observed = await getStyleGalleryObjectTextSnapshot(write.key).catch(() => null);
          if (observed?.text !== body || !observed.etag) throw error;
          etag = observed.etag;
        }
        committed.push({ write, etag });
      }
    } catch (error) {
      const failures = [];
      for (const { write, etag } of committed.reverse()) {
        try {
          await putStyleGalleryObject(
            write.key,
            new TextEncoder().encode(write.before.text ?? JSON.stringify(write.empty)),
            'application/json',
            { ifMatch: etag },
          );
        } catch (rollbackError) {
          failures.push(rollbackError);
        }
      }
      if (failures.length) throw new Error(`Image migration needs recovery: ${recoveryId}.`, { cause: error });
      if (error instanceof StyleGalleryObjectConflictError)
        throw conflict('Image migration conflicted with another write. Rerun after checking the card.');
      throw error;
    } finally {
      invalidateStyleGalleryStoreCache();
    }
    await invalidateStyleGalleryPublicCache(changed.map(({ item }) => item.slug));
    return { items: changes.map(({ item }) => item), changed: changed.length, recoveryId };
  });
}
