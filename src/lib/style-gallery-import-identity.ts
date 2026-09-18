import { createHash, randomUUID } from 'node:crypto';
import { invalidateByTag } from '@vercel/functions';
import { z } from 'zod';
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
import { compactStyleGalleryVisualIndex, replaceStyleGallerySourceVisualRecords } from './style-gallery-visual-index';
import type { StyleGalleryVisualRecordInput } from './style-gallery-visual-types';
import { serializeStyleGalleryWrite } from './style-gallery-write';

// Private import-only aliases: no list payload, SSR read, local attachment path or session text.
export const IMPORT_IDENTITY_KEY = 'metadata/import-image-identities-v1.json';
type Snapshot = Awaited<ReturnType<typeof getStyleGalleryObjectTextSnapshot>>;
const importAliasesSchema = z
  .object({
    version: z.literal(1),
    hashes: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.string().regex(/^[a-z0-9-]{1,160}$/i)),
  })
  .strict();

/** Only an absent object starts empty; corrupt stored aliases must never be silently discarded. */
export function parseImportAliases(text: string | null) {
  return importAliasesSchema.parse(text === null ? { version: 1, hashes: {} } : JSON.parse(text));
}
export type ImportIdentityQuery = { hashes: string[]; legacySlug: string };
const revision = (text: string) => createHash('sha256').update(text).digest('hex');
const conflict = (message: string) => new StyleGalleryClientError(message, 409);

async function readAliases() {
  const snapshot = await getStyleGalleryObjectTextSnapshot(IMPORT_IDENTITY_KEY);
  const value = parseImportAliases(snapshot.text);
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
 * Replace source bytes explicitly and keep the public URL suffix equal to the new image hash.
 * Move every slug-keyed index together; tags, example IDs/votes and independently edited prompts survive.
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
      if (!current) throw conflict('Card changed. Rerun to review current image identity.');
      const targetSlug = `${current.item.slug.slice(0, -12)}${replacement.imageHash.slice(0, 12)}`;
      if (current.item.imageHash === replacement.imageHash && current.item.slug === targetSlug)
        return { previous: current.item, item: current.item, snapshot: current.snapshot, job, changed: false };
      if (current.item.slug !== slug) throw conflict('Card changed. Rerun to review current image identity.');
      // A whole-request response may be lost after catalog publication. Same-target retries are read-only.
      if (revision(current.snapshot.text) !== expectedRevision)
        throw conflict('Card changed. Rerun to review current image identity.');
      const previous = current.item;
      if (previous.images.length !== replacement.images.length)
        throw conflict('Replacement must preserve image count and order.');
      const item = styleGalleryItemSchema.parse({
        ...previous,
        slug: targetSlug,
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
    const [catalogSnapshot, searchSnapshot, visualSnapshot, aliases, tagsSnapshot, exampleSnapshot] = await Promise.all([
      getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_CATALOG_KEY),
      getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_PROMPT_SEARCH_INDEX_KEY),
      getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_VISUAL_INDEX_KEY, 60_000),
      readAliases(),
      getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_TAG_KEY),
      getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_EXAMPLE_INDEX_KEY),
    ]);
    const catalog = styleGalleryCatalogSchema.parse(JSON.parse(catalogSnapshot.text ?? 'null'));
    const search = styleGalleryPromptSearchIndexSchema.parse(JSON.parse(searchSnapshot.text ?? 'null'));
    const tags = z
      .object({ version: z.literal(1), items: z.record(z.string(), galleryTagsSchema) })
      .parse(JSON.parse(tagsSnapshot.text ?? '{"version":1,"items":{}}'));
    const examples = styleGalleryExampleIndexSchema.parse(
      JSON.parse(exampleSnapshot.text ?? '{"version":2,"updatedAt":"1970-01-01T00:00:00.000Z","groups":[]}'),
    );
    const renamed = new Map(changed.map(({ previous, item }) => [previous.slug, item.slug]));
    for (const {
      previous,
      item,
      job: { slug, hashes },
    } of changed) {
      if (!catalog.items.some((entry) => entry.slug === slug && entry.imageHash === previous.imageHash))
        throw conflict('Card is no longer active.');
      if (
        catalog.items.some((entry) => entry.slug !== slug && (entry.imageHash === item.imageHash || entry.slug === item.slug))
      )
        throw conflict('Original image already has a card. Merge the cards before retrying.');
      for (const hash of [...hashes, previous.imageHash, item.imageHash]) {
        const bound = aliases.value.hashes[hash];
        const boundItem = bound && bound !== slug ? await readIdentity(bound) : null;
        if (boundItem && boundItem.item.slug !== slug) throw conflict('Image alias belongs to another card.');
        aliases.value.hashes[hash] = item.slug;
      }
      delete search.entries[slug];
      search.entries[item.slug] = toStyleGalleryPromptSearchEntry(item);
      if (tags.items[slug]) {
        tags.items[item.slug] = tags.items[slug];
        delete tags.items[slug];
      }
      search.updatedAt = item.updated ?? item.date;
      catalog.items = catalog.items.map((entry) => (entry.slug === slug ? toStyleGalleryCatalogItem(item) : entry));
      catalog.updatedAt = item.updated ?? item.date;
    }
    for (const [hash, slug] of Object.entries(aliases.value.hashes)) aliases.value.hashes[hash] = renamed.get(slug) ?? slug;
    examples.groups = examples.groups.map((group) => ({
      ...group,
      sourceSlug: renamed.get(group.sourceSlug) ?? group.sourceSlug,
    }));
    examples.updatedAt = catalog.updatedAt;
    const visual = styleGalleryVisualIndexSchema.parse(JSON.parse(visualSnapshot.text ?? 'null'));
    visual.records = visual.records.map((record) => ({
      ...record,
      sourceSlug: renamed.get(record.sourceSlug) ?? record.sourceSlug,
    }));
    const detailWrites = await mapWithConcurrency(changed, 5, async ({ previous, item, snapshot }) => {
      const target = await getStyleGalleryObjectTextSnapshot(getStyleGalleryItemKey(item.slug));
      // A rolled-back attempt may have left a redirect to the old identity. Never overwrite another detail.
      if (target.text && JSON.parse(target.text).mergedInto !== previous.slug)
        throw conflict('Replacement URL already exists.');
      return [
        { key: getStyleGalleryItemKey(item.slug), before: target, value: item, empty: { mergedInto: previous.slug } },
        { key: getStyleGalleryItemKey(previous.slug), before: snapshot, value: { mergedInto: item.slug } },
      ];
    });
    const writes: { key: string; before: Snapshot; value: unknown; empty?: unknown }[] = [
      ...detailWrites.flat(),
      { key: STYLE_GALLERY_TAG_KEY, before: tagsSnapshot, value: tags, empty: { version: 1, items: {} } },
      {
        key: STYLE_GALLERY_EXAMPLE_INDEX_KEY,
        before: exampleSnapshot,
        value: examples,
        empty: { version: 2, updatedAt: new Date(0).toISOString(), groups: [] },
      },
      { key: STYLE_GALLERY_PROMPT_SEARCH_INDEX_KEY, before: searchSnapshot, value: search },
      {
        key: STYLE_GALLERY_VISUAL_INDEX_KEY,
        before: visualSnapshot,
        value: compactStyleGalleryVisualIndex(
          replaceStyleGallerySourceVisualRecords(
            visual,
            new Set(changed.map(({ item }) => item.slug)),
            changed.flatMap(({ job, item }) => job.visualRecords.map((record) => ({ ...record, sourceSlug: item.slug }))),
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
          identitySnapshot: aliases.snapshot,
          snapshots: writes.map(({ key, before }) => ({ key, ...before })),
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
    await invalidateStyleGalleryPublicCache(changed.flatMap(({ previous, item }) => [previous.slug, item.slug]));
    try {
      await invalidateByTag(STYLE_GALLERY_TAG_CACHE_TAG);
    } catch {
      /* Local CLI has no Vercel runtime. */
    }
    return { items: changes.map(({ item }) => item), changed: changed.length, recoveryId };
  });
}
