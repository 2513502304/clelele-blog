import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  createStyleGallerySignedImageUrl,
  getStyleGalleryObjectBytes,
  getStyleGalleryObjectTextSnapshot,
  putStyleGalleryObject,
  StyleGalleryObjectConflictError,
} from '../src/lib/hf-s3-presign';
import { mapWithConcurrency } from '../src/lib/map-with-concurrency';
import { readStyleGalleryImageDimensions, readWebpHeaderDimensions } from '../src/lib/style-gallery-image-dimensions';
import { styleGalleryImageDimensionsSchema } from '../src/lib/style-gallery-schema';
import type { StyleGalleryImageDimensions } from '../src/types/style-gallery';

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    'remove-tags': { type: 'boolean', default: false },
    'work-dir': { type: 'string', default: '/tmp/style-gallery-dimensions' },
    concurrency: { type: 'string', default: '12' },
  },
});
const workDir = path.resolve(values['work-dir']);
const concurrency = Number(values.concurrency);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 24) throw new Error('Concurrency must be 1–24.');
await mkdir(path.join(workDir, 'dimensions'), { recursive: true });
await mkdir(path.join(workDir, 'backups'), { recursive: true });
const dimensions = new Map<string, Promise<StyleGalleryImageDimensions>>();
let inspected = 0;
let changed = 0;

/** Prefix requests usually contain all image headers and avoid downloading gigabytes of pixels. */
async function inspectImage(source: string): Promise<StyleGalleryImageDimensions> {
  const key = source.replace(/^\/api\/style-gallery\/image\//, '');
  if (!/^(source|examples\/images)\/[a-zA-Z0-9._-]+$/.test(key)) throw new Error('Invalid image object key.');
  const cachePath = path.join(workDir, 'dimensions', `${createHash('sha256').update(key).digest('hex')}.json`);
  try {
    return styleGalleryImageDimensionsSchema.parse(JSON.parse(await readFile(cachePath, 'utf8')));
  } catch {
    /* Missing/invalid cache entries are rebuilt from immutable image objects. */
  }
  let result: StyleGalleryImageDimensions | undefined;
  for (let attempt = 0; attempt < 3 && !result; attempt++) {
    try {
      for (const size of [65_536, 262_144, 1_048_576]) {
        const response = await fetch(createStyleGallerySignedImageUrl(key), {
          headers: { Range: `bytes=0-${size - 1}` },
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`Image header request returned ${response.status}.`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        result = readWebpHeaderDimensions(bytes);
        if (result) break;
        // EXIF may be at the end of a WebP; additional prefixes cannot establish orientation.
        if (Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP' && response.status === 206) break;
        try {
          result = await readStyleGalleryImageDimensions(bytes);
          break;
        } catch {
          if (response.status === 200 || bytes.length < size) throw new Error(`Invalid image headers: ${key}`);
        }
      }
      if (!result) {
        const bytes = await getStyleGalleryObjectBytes(key);
        if (!bytes) throw new Error(`Missing image: ${key}`);
        result = await readStyleGalleryImageDimensions(bytes);
      }
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  const valid = styleGalleryImageDimensionsSchema.parse(result);
  await writeFile(cachePath, JSON.stringify(valid));
  inspected++;
  if (inspected % 200 === 0) console.log(`Read dimensions: ${inspected}`);
  return valid;
}

function getDimensions(source: string) {
  let pending = dimensions.get(source);
  if (!pending) {
    pending = inspectImage(source);
    dimensions.set(source, pending);
  }
  return pending;
}

interface ImageRecord {
  sourceImage?: string;
  src?: string;
  dimensions?: StyleGalleryImageDimensions;
}
interface Metadata {
  items?: Array<ImageRecord & { slug: string }>;
  images?: ImageRecord[];
  examples?: ImageRecord[];
  groups?: Array<{ examples: ImageRecord[] }>;
  tags?: string[];
}

/** Only dimensions (and explicitly requested obsolete tags) change; timestamps and likes are preserved. */
async function enrich(metadata: Metadata) {
  const records = metadata.items ?? [
    ...(metadata.images ?? []),
    ...(metadata.examples ?? []),
    ...(metadata.groups?.flatMap((group) => group.examples) ?? []),
  ];
  await mapWithConcurrency(records, concurrency, async (record) => {
    if (record.dimensions) {
      styleGalleryImageDimensionsSchema.parse(record.dimensions);
      return;
    }
    const source = record.sourceImage ?? record.src;
    if (!source) throw new Error('Image reference has no source.');
    record.dimensions = await getDimensions(source);
  });
  if (values['remove-tags'] && metadata.items) delete metadata.tags;
}

/** Conditional writes retry against current data, so concurrent uploads or likes are never overwritten. */
async function updateObject(key: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const snapshot = await getStyleGalleryObjectTextSnapshot(key, 60_000);
    if (!snapshot.text || !snapshot.etag) throw new Error(`Missing metadata or ETag: ${key}`);
    const metadata: Metadata = JSON.parse(snapshot.text);
    const before = JSON.stringify(metadata);
    await enrich(metadata);
    if (JSON.stringify(metadata) === before) return;
    if (!values.apply) {
      changed++;
      return;
    }
    // Each overwritten revision has its own backup, including conflict retries.
    const revision = createHash('sha256').update(snapshot.text).digest('hex').slice(0, 16);
    await writeFile(path.join(workDir, 'backups', `${key.replaceAll('/', '_')}.${revision}.json`), snapshot.text);
    try {
      await putStyleGalleryObject(key, new TextEncoder().encode(JSON.stringify(metadata)), 'application/json', {
        ifMatch: snapshot.etag,
      });
      changed++;
      return;
    } catch (error) {
      if (!(error instanceof StyleGalleryObjectConflictError) || attempt === 5) throw error;
    }
  }
}

try {
  const catalog = await getStyleGalleryObjectTextSnapshot('metadata/catalog-v5.json', 60_000);
  if (!catalog.text) throw new Error('Missing catalog.');
  const slugs: string[] = JSON.parse(catalog.text).items.map((item: { slug: string }) => item.slug);
  if (slugs.some((slug) => !/^[a-z0-9-]+$/i.test(slug))) throw new Error('Invalid catalog slug.');
  // Populate the shared cache from the two small indexes before processing all details.
  await updateObject('metadata/catalog-v5.json');
  await updateObject('examples/index-v2.json');
  let completed = 0;
  await mapWithConcurrency(slugs, concurrency, async (slug) => {
    await updateObject(`items/${slug}.json`);
    completed++;
    if (completed % 200 === 0) console.log(`Checked items: ${completed}/${slugs.length}`);
  });
  console.log(
    JSON.stringify({
      mode: values.apply ? 'applied' : 'dry-run',
      items: slugs.length,
      changedObjects: changed,
      inspectedImages: inspected,
      removeTags: values['remove-tags'],
      workDir,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Backfill failed.');
  process.exitCode = 1;
}
