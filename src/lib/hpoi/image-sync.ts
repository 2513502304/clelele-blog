import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { matchCover } from './image-match';
import { readHpoiGallery, readHpoiSource } from './image-source';
import { type CachedHpoiImage, hpoiImageStorage, publishHpoiImage, readHpoiImageManifest } from './image-store';

const inFlight = new Map<string, Promise<CachedHpoiImage>>();
const queued = new Set<string>();
const retryAfter = new Map<string, number>();
let draining = false;

async function processImage(id: string): Promise<CachedHpoiImage> {
  const existing = (await readHpoiImageManifest())[id];
  if (existing) return existing;
  const client = hpoiImageStorage();
  const save = async (bytes: Buffer) => {
    const key = `objects/${createHash('sha256').update(bytes).digest('hex')}.jpg`;
    if (!(await client.head(key)).exists) await client.put(key, bytes, 'image/jpeg');
    return key;
  };
  const gallery = await readHpoiGallery(id);
  const cover = await readHpoiSource(gallery.cover);
  const dimensions = await sharp(cover).metadata();
  if (!dimensions.width || !dimensions.height) throw new Error('Invalid Hpoi cover dimensions');
  const coverJpeg = await sharp(cover).flatten({ background: '#fff' }).jpeg({ quality: 95 }).toBuffer();
  const fallbackKey = await save(coverJpeg);
  const candidates: CachedHpoiImage['candidates'] = [];
  // The official /s/ derivative preserves the photo composition (unlike /cover/).
  // Rank these smaller files; download and re-align only the winning HD original.
  for (const url of gallery.urls) {
    const preview = await readHpoiSource(url.replace('/gk/pic/n/', '/gk/pic/s/'));
    const match = await matchCover(cover, preview);
    candidates.push({ url, similarity: match.score });
  }
  const ranked = [...candidates].sort((a, b) => b.similarity - a.similarity);
  const selected = ranked[0];
  let winner: { bytes: Buffer; match: Awaited<ReturnType<typeof matchCover>> } | undefined;
  if (selected) {
    const bytes = await readHpoiSource(selected.url);
    winner = { bytes, match: await matchCover(cover, bytes) };
  }
  // An uncertain match stays on the original cover. Similar duplicate photographs are safe only
  // at very high similarity; white backgrounds must not make a box/back view win by accident.
  const confident =
    winner?.match &&
    winner.match.score >= 0.67 &&
    (winner.match.score >= 0.9 || winner.match.score - (ranked[1]?.similarity ?? 0) >= 0.045);
  let key = fallbackKey;
  let originalKey: string | undefined;
  if (winner?.match && confident) {
    const meta = await sharp(winner.bytes).metadata();
    if (!meta.width || !meta.height) throw new Error('Invalid HD dimensions');
    const left = Math.round(winner.match.left * meta.width);
    const top = Math.round(winner.match.top * meta.height);
    const width = Math.min(meta.width - left, Math.round(winner.match.width * meta.width));
    const height = Math.min(meta.height - top, Math.round(winner.match.height * meta.height));
    // Preserve the cover crop and aspect ratio. Never call an upscaled thumbnail an HD replacement.
    if (width > dimensions.width && height > dimensions.height) {
      originalKey = await save(
        meta.format === 'jpeg' ? winner.bytes : await sharp(winner.bytes).jpeg({ quality: 95 }).toBuffer(),
      );
      key = await save(
        await sharp(winner.bytes)
          .extract({ left, top, width, height })
          .resize({ width, height: Math.round((width * dimensions.height) / dimensions.width), fit: 'fill' })
          .flatten({ background: '#fff' })
          .jpeg({ quality: 95 })
          .toBuffer(),
      );
    }
  }
  const record: CachedHpoiImage = {
    coverUrl: gallery.cover,
    width: dimensions.width,
    height: dimensions.height,
    key,
    fallbackKey,
    score: gallery.score,
    matched: key !== fallbackKey,
    originalKey,
    processedAt: new Date().toISOString(),
    candidates,
  };
  await publishHpoiImage(id, record);
  return record;
}

/** Idempotent per figure: completed entries (including conservative fallbacks) are never rematched. */
export function syncHpoiImage(id: string): Promise<CachedHpoiImage> {
  if (!/^[1-9]\d{0,9}$/.test(id)) return Promise.reject(new Error('Invalid Hpoi ID'));
  const existing = inFlight.get(id);
  if (existing) return existing;
  const task = processImage(id).finally(() => inFlight.delete(id));
  inFlight.set(id, task);
  return task;
}

/** Only IDs discovered in the configured public collection enter this single-worker background queue.
 * Container interruption leaves no completed manifest entry; a subsequent visit resumes missing IDs.
 * Browsers never download galleries or run CV, and failed upstream reads back off for an hour.
 */
export function queueHpoiImages(ids: string[]): void {
  for (const id of ids) if ((retryAfter.get(id) ?? 0) <= Date.now()) queued.add(id);
  if (draining) return;
  draining = true;
  void (async () => {
    try {
      for (const id of queued) {
        queued.delete(id);
        try {
          await syncHpoiImage(id);
        } catch {
          retryAfter.set(id, Date.now() + 3_600_000);
          console.warn(`[hpoi-images] ${id} deferred after upstream/storage failure`);
        }
      }
    } finally {
      draining = false;
    }
  })();
}
