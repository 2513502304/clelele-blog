import { createHash, randomInt } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { z } from 'zod';
import type { StyleGalleryExampleIndexGroup } from '@/types/style-gallery';
import {
  getStyleGalleryObjectBytes,
  getStyleGalleryObjectEtag,
  getStyleGalleryObjectTextSnapshot,
  putStyleGalleryObject,
  StyleGalleryObjectConflictError,
} from './hf-s3-presign';
import { materializeExamples, readExampleRootSnapshot, STYLE_GALLERY_EXAMPLE_INDEX_KEY } from './style-gallery-example-shards';
import { parseStyleGalleryImageApiPath } from './style-gallery-image-key';
import { mutateVisualIndexSnapshot, STYLE_GALLERY_VISUAL_INDEX_KEY } from './style-gallery-store';
import { removeStyleGalleryVisualRecords, upsertStyleGalleryVisualRecords } from './style-gallery-visual-index';
import type {
  StyleGalleryVisualFeature,
  StyleGalleryVisualIndex,
  StyleGalleryVisualRecordInput,
} from './style-gallery-visual-types';

const checkpointKey = 'metadata/cache/example-visual-checkpoint-v1.json';
const checkpointSchema = z.object({
  examples: z.string(),
  visual: z.string(),
  packs: z.record(z.string(), z.string()).optional(),
});
type Checkpoint = z.infer<typeof checkpointSchema>;

/** Only the derived index changes here. Source embeddings and legacy non-content-addressed images keep their records. */
export async function reconcileVisualGroups(
  current: StyleGalleryVisualIndex,
  groups: StyleGalleryExampleIndexGroup[],
  touched: Set<string> | undefined,
  compute: (key: string, hash: string) => Promise<StyleGalleryVisualFeature>,
  limit = 8,
) {
  const features = new Map(current.features.map((f) => [f.imageHash, f]));
  const existing = new Map(
    current.records
      .filter((r) => r.kind === 'example')
      .map((r) => [r.sourceSlug + '/' + r.imageId, current.features[r.featureIndex].imageHash]),
  );
  const ids = new Set<string>();
  const needed: { sourceSlug: string; imageId: string; key: string; hash: string }[] = [];
  for (const { sourceSlug, examples } of groups) {
    for (const example of examples) {
      const id = sourceSlug + '/' + example.id;
      ids.add(id);
      const key = parseStyleGalleryImageApiPath(example.src);
      const hash = key?.match(/^examples\/images\/([a-f0-9]{64})\./i)?.[1];
      if (hash && key && existing.get(id) !== hash) needed.push({ sourceSlug, imageId: example.id, key, hash });
    }
  }
  const retained = removeStyleGalleryVisualRecords(
    current,
    (r) => r.kind === 'example' && (!touched || touched.has(r.sourceSlug)) && !ids.has(r.sourceSlug + '/' + r.imageId),
  );
  const additions: StyleGalleryVisualRecordInput[] = [];
  let computed = 0;
  // Rotate bounded batches so a broken object cannot starve later images across restarts.
  const start = needed.length > limit ? randomInt(needed.length) : 0;
  for (let i = 0; i < needed.length; i++) {
    const { sourceSlug, imageId, key, hash } = needed[(start + i) % needed.length];
    let feature = features.get(hash);
    if (!feature) {
      if (computed >= limit) continue;
      computed++;
      try {
        feature = await compute(key, hash);
      } catch {
        continue;
      }
      features.set(hash, feature);
    }
    additions.push({ kind: 'example', sourceSlug, imageId, feature });
  }
  return { index: upsertStyleGalleryVisualRecords(retained, additions), remaining: needed.length - additions.length };
}

async function compute(key: string, hash: string) {
  const bytes = await getStyleGalleryObjectBytes(key);
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== hash) throw Error('Unverified visual index input');
  const { computeStyleGalleryVisualFeatureFromBytes } = await import('./style-gallery-visual-feature-node');
  return computeStyleGalleryVisualFeatureFromBytes(bytes, hash);
}

async function run() {
  const [stored, rootEtag, visualEtag] = await Promise.all([
    getStyleGalleryObjectTextSnapshot(checkpointKey),
    getStyleGalleryObjectEtag(STYLE_GALLERY_EXAMPLE_INDEX_KEY),
    getStyleGalleryObjectEtag(STYLE_GALLERY_VISUAL_INDEX_KEY),
  ]);
  let previous: Checkpoint | undefined;
  try {
    previous = checkpointSchema.parse(JSON.parse(stored.text ?? 'null'));
  } catch {
    /* Rebuild a lost or incompatible checkpoint. */
  }
  if (previous && rootEtag === previous.examples && visualEtag === previous.visual) return { remaining: 0 };
  let completed: Omit<Checkpoint, 'visual'> | undefined;
  let remaining = 0;
  const result = await mutateVisualIndexSnapshot(async (index, etag) => {
    completed = undefined;
    // Reread the authority after taking the visual snapshot on EVERY CAS attempt. Deletions, retries and rollbacks
    // can only advance the checkpoint for the exact pair of revisions that was reconciled.
    const { root, etag: examples } = await readExampleRootSnapshot();
    if (!examples) throw Error('Missing example index revision');
    const packs = root.version === 3 ? Object.fromEntries(root.groups.map((r) => [r.sourceSlug, r.pack])) : undefined;
    const baseline = previous?.visual === etag ? previous?.packs : undefined;
    const touched =
      packs && baseline
        ? new Set([...Object.keys(packs), ...Object.keys(baseline)].filter((s) => packs[s] !== baseline[s]))
        : undefined;
    const partition =
      root.version === 3 && touched ? { ...root, groups: root.groups.filter((r) => touched.has(r.sourceSlug)) } : root;
    const { groups } = await materializeExamples(partition);
    const repair = await reconcileVisualGroups(index, groups, touched, compute);
    remaining = repair.remaining;
    if (!remaining) completed = { examples, packs };
    return repair.index;
  });
  if (completed && result.etag) {
    const checkpoint: Checkpoint = { ...completed, visual: result.etag };
    try {
      await putStyleGalleryObject(
        checkpointKey,
        Buffer.from(JSON.stringify(checkpoint)),
        'application/json',
        stored.etag ? { ifMatch: stored.etag } : { ifNoneMatch: '*' },
      );
    } catch (error) {
      if (!(error instanceof StyleGalleryObjectConflictError)) throw error;
    }
  }
  return { remaining };
}

let active: ReturnType<typeof run> | undefined;
/** Coalesce local wake-ups. A lost wake-up is repaired by the next timer from durable public membership. */
export function repairExampleVisualIndex() {
  active ??= run().finally(() => {
    active = undefined;
  });
  return active;
}
export function scheduleExampleVisualRepair() {
  waitUntil(
    repairExampleVisualIndex()
      .then(({ remaining }) => {
        if (remaining) console.warn('[style-gallery] Visual index has outstanding images.');
      })
      .catch(() => console.warn('[style-gallery] Visual repair will retry from the public example manifest.')),
  );
}
