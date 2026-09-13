import { parseArgs } from 'node:util';
import {
  getStyleGalleryObjectBytes,
  getStyleGalleryObjectText,
  headStyleGalleryObject,
  putStyleGalleryObject,
} from '../src/lib/hf-s3-presign';
import { mapWithConcurrency } from '../src/lib/map-with-concurrency';
import { encodeStyleGalleryExampleThumbnail } from '../src/lib/style-gallery-example-thumbnail';
import { getStyleGalleryExampleThumbnailKey, parseStyleGalleryImageApiPath } from '../src/lib/style-gallery-image-key';
import { styleGalleryExampleIndexSchema } from '../src/lib/style-gallery-schema';
import { backfillThumbnailsWithS5cmd } from './lib/style-gallery-thumbnail-s5cmd';

/**
 * Resumable asset-only migration. Existing thumbnails are skipped; originals and
 * metadata are never rewritten, so concurrent likes/uploads cannot be overwritten.
 * Memory is bounded by concurrency; source bytes are released after each derivative.
 * Re-run after rollout to catch uploads published by an older deployment.
 */
const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    s5cmd: { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '8' },
    limit: { type: 'string' },
  },
});
const concurrency = Number(values.concurrency);
const limit = values.limit === undefined ? undefined : Number(values.limit);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('Concurrency must be 1–32.');
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error('Limit must be a positive integer.');
const text = await getStyleGalleryObjectText('examples/index-v2.json');
if (!text) throw new Error('Example index is missing.');
const index = styleGalleryExampleIndexSchema.parse(JSON.parse(text));
const sources = [
  ...new Map(
    index.groups.flatMap((group) =>
      group.examples.map((example) => [getStyleGalleryExampleThumbnailKey(example.src), example.src] as const),
    ),
  ).values(),
].slice(0, limit);
if (values.s5cmd) {
  await backfillThumbnailsWithS5cmd(sources, values.apply, concurrency);
} else {
  let checked = 0,
    existing = 0,
    created = 0,
    missing = 0,
    failed = 0,
    originalBytes = 0,
    thumbnailBytes = 0;
  const phases = new Map<string, string>();
  const report = setInterval(
    () =>
      console.log(
        JSON.stringify({
          checked,
          existing,
          created,
          missing,
          failed,
          originalBytes,
          thumbnailBytes,
          phases: [...phases.values()].reduce<Record<string, number>>((counts, phase) => {
            counts[phase] = (counts[phase] ?? 0) + 1;
            return counts;
          }, {}),
        }),
      ),
    30_000,
  );
  console.log(JSON.stringify({ mode: values.apply ? 'apply' : 'audit', images: sources.length, concurrency }));
  await mapWithConcurrency(sources, concurrency, async (source) => {
    const key = getStyleGalleryExampleThumbnailKey(source);
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          phases.set(key, 'head');
          if (await headStyleGalleryObject(key)) {
            existing++;
            break;
          }
          if (!values.apply) {
            missing++;
            break;
          }
          const originalKey = parseStyleGalleryImageApiPath(source);
          if (!originalKey) throw new Error('Invalid original path.');
          phases.set(key, 'download');
          const original = await getStyleGalleryObjectBytes(originalKey);
          if (!original) throw new Error('Original is missing.');
          phases.set(key, 'encode');
          const thumbnail = await encodeStyleGalleryExampleThumbnail(original);
          phases.set(key, 'upload');
          await putStyleGalleryObject(key, thumbnail, 'image/webp');
          originalBytes += original.byteLength;
          thumbnailBytes += thumbnail.byteLength;
          created++;
          break;
        } catch (error) {
          if (attempt >= 3) throw error;
        }
      }
    } catch {
      // Never print signed URLs, credentials, or production metadata in failure logs.
      failed++;
      console.error(`Failed derivative: ${key}`);
    } finally {
      phases.delete(key);
      checked++;
      if (checked % 100 === 0)
        console.log(JSON.stringify({ checked, existing, created, missing, failed, originalBytes, thumbnailBytes }));
    }
  });
  clearInterval(report);
  console.log(JSON.stringify({ checked, existing, created, missing, failed, originalBytes, thumbnailBytes }));
  if (missing || failed) process.exitCode = 1;
}
