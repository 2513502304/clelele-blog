import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { waitUntil } from '@vercel/functions';
import { z } from 'zod';
import type { StyleGalleryExampleIndex, StyleGalleryExampleIndexGroup } from '@/types/style-gallery';
import {
  getStyleGalleryObjectBytes,
  getStyleGalleryObjectTextSnapshot,
  putStyleGalleryObject,
  StyleGalleryObjectConflictError,
  type StyleGalleryObjectWriteConditions,
} from './hf-s3-presign';
import { mapWithConcurrency } from './map-with-concurrency';
import { styleGalleryExampleIndexSchema } from './style-gallery-schema';

// The publication key stays fixed so a pre-migration writer's If-Match cannot overwrite the cutover.
export const STYLE_GALLERY_EXAMPLE_INDEX_KEY = 'examples/index-v2.json';
const prefix = 'examples/shards-v3/';
const encode = promisify(gzip);
const decode = promisify(gunzip);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const groupSchema = styleGalleryExampleIndexSchema.shape.groups;
const manifestSchema = z.object({
  version: z.literal(3),
  updatedAt: styleGalleryExampleIndexSchema.shape.updatedAt,
  groups: z.array(z.object({ sourceSlug: z.string().regex(/^[a-z0-9-]+$/i), pack: z.string().regex(/^[a-f0-9]{64}$/) })),
});
export type ExampleManifest = z.infer<typeof manifestSchema>;
export type ExampleRoot = StyleGalleryExampleIndex | ExampleManifest;
type Group = StyleGalleryExampleIndexGroup;
const rawPackLimit = 4 * 1024 * 1024;
const cacheLimit = 64 * 1024 * 1024;
const cache = new Map<string, { groups: Map<string, Group>; size: number }>();
const loading = new Map<string, Promise<Map<string, Group>>>();
let cachedBytes = 0;

function uniqueGroups<T extends { sourceSlug: string }>(groups: T[]) {
  const bySlug = new Map(groups.map((group) => [group.sourceSlug, group]));
  if (bySlug.size !== groups.length) throw Error('Duplicate source slug in the gallery example index.');
  return bySlug;
}

export function parseExampleRoot(text: string | null): ExampleRoot {
  if (text === null) return { version: 2, updatedAt: new Date(0).toISOString(), groups: [] };
  const json = JSON.parse(text);
  const root = json.version === 3 ? manifestSchema.parse(json) : styleGalleryExampleIndexSchema.parse(json);
  uniqueGroups<{ sourceSlug: string }>(root.groups);
  return root;
}

async function fetchPack(id: string) {
  const bytes = await getStyleGalleryObjectBytes(`${prefix + id}.json.gz`);
  if (!bytes || hash(bytes) !== id) throw Error(`Missing or damaged gallery example shard: ${id}`);
  const data = await decode(bytes);
  const groups = uniqueGroups(groupSchema.parse(JSON.parse(data.toString('utf8'))));
  return { groups, size: data.length };
}

/** Immutable, digest-checked packs can be reused across manifest revisions and simultaneous readers. */
async function loadPack(id: string, verify: boolean) {
  if (verify) return (await fetchPack(id)).groups;
  const hit = cache.get(id);
  if (hit) {
    cache.delete(id);
    cache.set(id, hit);
    return hit.groups;
  }
  const pending = loading.get(id);
  if (pending) return pending;
  const read = fetchPack(id).then((pack) => {
    while (cache.size && cachedBytes + pack.size > cacheLimit) {
      const oldest = cache.entries().next().value;
      if (!oldest) break;
      cachedBytes -= oldest[1].size;
      cache.delete(oldest[0]);
    }
    if (pack.size <= cacheLimit) {
      cache.set(id, pack);
      cachedBytes += pack.size;
    }
    return pack.groups;
  });
  loading.set(id, read);
  try {
    return await read;
  } finally {
    loading.delete(id);
  }
}

/** Keep the public v2 shape and its ordering for both full reads and a requested source. */
export async function materializeExamples(root: ExampleRoot, slug?: string, verify = false): Promise<StyleGalleryExampleIndex> {
  if (root.version === 2) return slug ? { ...root, groups: root.groups.filter((g) => g.sourceSlug === slug) } : root;
  const refs = slug ? root.groups.filter((g) => g.sourceSlug === slug) : root.groups;
  const ids = [...new Set(refs.map((r) => r.pack))];
  const packs = new Map(await mapWithConcurrency(ids, 6, async (id) => [id, await loadPack(id, verify)] as const));
  const groups = refs.map((ref) => {
    const group = packs.get(ref.pack)?.get(ref.sourceSlug);
    if (!group) throw Error(`Missing group in gallery example shard: ${ref.sourceSlug}`);
    return group;
  });
  return { version: 2, updatedAt: root.updatedAt, groups };
}

async function stagePack(groups: Group[]) {
  const bytes = await encode(JSON.stringify(groups));
  const id = hash(bytes);
  // The key is derived from every byte. An interrupted stage has no visible effect until the root CAS.
  await putStyleGalleryObject(`${prefix + id}.json.gz`, bytes, 'application/gzip');
  return id;
}

/** Pack cold data in batches so the first full-gallery read does not need a request for every item. */
export async function stageExampleGroups(groups: Group[]) {
  const chunks: Group[][] = [];
  let chunk: Group[] = [],
    size = 0;
  for (const group of groups) {
    const length = Buffer.byteLength(JSON.stringify(group));
    if (chunk.length && (size + length > rawPackLimit || chunk.length >= 128)) {
      chunks.push(chunk);
      chunk = [];
      size = 0;
    }
    chunk.push(group);
    size += length;
  }
  if (chunk.length) chunks.push(chunk);
  return (
    await mapWithConcurrency(chunks, 4, async (part) => {
      const pack = await stagePack(part);
      return part.map((group) => ({ sourceSlug: group.sourceSlug, pack }));
    })
  ).flat();
}

type PackingHint = { from: string; to: string };
let readyPacking = new Map<string, PackingHint>();
let packing: Promise<void> | undefined;

/** Prepare equivalent immutable read packs off the save path. A future normal CAS may adopt them;
 * the background task never writes the publication key or invalidates a transaction's rollback ETag.
 */
export function queueExamplePacking(root: ExampleRoot) {
  if (root.version !== 3 || packing) return;
  const counts = new Map<string, number>();
  for (const ref of root.groups) counts.set(ref.pack, (counts.get(ref.pack) ?? 0) + 1);
  const limit = Math.max(32, Math.ceil(root.groups.length / 64) * 2 + 16);
  if (counts.size <= limit) return;
  const smallest = new Set(
    [...counts]
      .sort((a, b) => a[1] - b[1])
      .slice(0, 12)
      .map(([id]) => id),
  );
  const selected = root.groups.filter((r) => smallest.has(r.pack));
  packing = (async () => {
    const { groups } = await materializeExamples({ ...root, groups: selected });
    const refs = uniqueGroups(await stageExampleGroups(groups));
    const hints = new Map<string, PackingHint>();
    for (const old of selected) {
      const replacement = refs.get(old.sourceSlug);
      if (replacement && old.pack !== replacement.pack) hints.set(old.sourceSlug, { from: old.pack, to: replacement.pack });
    }
    readyPacking = hints;
  })()
    .catch(() => {
      console.warn('[style-gallery] Example packing deferred; all source shards remain readable.');
    })
    .finally(() => {
      packing = undefined;
    });
  waitUntil(packing);
  return packing;
}

/** Stage only changed groups and atomically publish their ordered references with the observed root ETag. */
export async function prepareExampleRoot(
  root: ExampleRoot,
  current: StyleGalleryExampleIndex,
  next: StyleGalleryExampleIndex,
  slug?: string,
): Promise<ExampleRoot> {
  if (root.version === 2) return next;
  const old = uniqueGroups(current.groups);
  const oldRefs = uniqueGroups(root.groups);
  uniqueGroups(next.groups);
  if (slug && next.groups.some((g) => g.sourceSlug !== slug)) throw Error('Out-of-scope gallery example group.');
  const changed = next.groups.filter((g) => {
    const prev = old.get(g.sourceSlug);
    return g !== prev && JSON.stringify(g) !== JSON.stringify(prev);
  });
  const refs = uniqueGroups(await stageExampleGroups(changed));
  const edited = next.groups.map((group) => {
    const ref = refs.get(group.sourceSlug) ?? oldRefs.get(group.sourceSlug);
    if (!ref) throw Error(`Unstaged gallery example group: ${group.sourceSlug}`);
    return ref;
  });
  const manifest: ExampleManifest = {
    version: 3,
    updatedAt: next.updatedAt,
    groups: slug ? [...root.groups.filter((g) => g.sourceSlug !== slug), ...edited] : edited,
  };
  // Concurrent edits retain their own pack; only byte-equivalent groups from an earlier manifest can be folded in.
  if (readyPacking.size)
    manifest.groups = manifest.groups.map((ref) => {
      const hint = readyPacking.get(ref.sourceSlug);
      return hint?.from === ref.pack ? { ...ref, pack: hint.to } : ref;
    });
  return manifest;
}

export async function readExampleRootSnapshot() {
  const { text, etag } = await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_EXAMPLE_INDEX_KEY, 60_000);
  return { root: parseExampleRoot(text), etag, exists: text !== null };
}

export function putExampleRoot(root: ExampleRoot, conditions: StyleGalleryObjectWriteConditions) {
  return putStyleGalleryObject(
    STYLE_GALLERY_EXAMPLE_INDEX_KEY,
    Buffer.from(JSON.stringify(root)),
    'application/json; charset=utf-8',
    conditions,
  );
}

/** Admin transactions back up logical v2 documents but use the physical publication ETag for writes and rollback. */
export async function readGalleryMetadataSnapshot(key: string, timeout?: number) {
  if (key !== STYLE_GALLERY_EXAMPLE_INDEX_KEY) return getStyleGalleryObjectTextSnapshot(key, timeout);
  const snap = await readExampleRootSnapshot();
  return { text: snap.exists ? JSON.stringify(await materializeExamples(snap.root)) : null, etag: snap.etag };
}

export async function writeGalleryMetadata(
  key: string,
  bytes: Uint8Array,
  type: string,
  conditions: StyleGalleryObjectWriteConditions,
) {
  if (key !== STYLE_GALLERY_EXAMPLE_INDEX_KEY) return putStyleGalleryObject(key, bytes, type, conditions);
  const { root, etag, exists } = await readExampleRootSnapshot();
  if ((conditions.ifMatch && etag !== conditions.ifMatch) || (conditions.ifNoneMatch && exists))
    throw new StyleGalleryObjectConflictError('Gallery example index changed.');
  if (!conditions.ifMatch && !conditions.ifNoneMatch) throw Error('Conditional write required for gallery examples.');
  const next = styleGalleryExampleIndexSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  const value = await prepareExampleRoot(root, await materializeExamples(root), next);
  return putExampleRoot(value, conditions);
}
