import { matchCover } from './image-match';
import { cacheHpoiOriginal } from './image-original';
import { reviewedHpoiOriginals } from './image-reviewed';
import { readHpoiCandidate, readHpoiGallery, readHpoiSource } from './image-source';
import {
  type CachedHpoiImage,
  hpoiImageStorage,
  publishHpoiImage,
  readCompletedHpoiImage,
  readHpoiImageManifest,
  readLegacyHpoiImageManifest,
} from './image-store';

const inFlight = new Map<string, Promise<CachedHpoiImage>>();
const queued = new Set<string>();
const retryAfter = new Map<string, number>();
let draining = false;
let legacyRead: ReturnType<typeof readLegacyHpoiImageManifest> | undefined;
function legacyManifest() {
  legacyRead ??= readLegacyHpoiImageManifest().catch((error) => {
    legacyRead = undefined;
    throw error;
  });
  return legacyRead;
}

async function processImage(id: string): Promise<CachedHpoiImage> {
  const existing = (await readHpoiImageManifest())[id];
  if (existing) return existing;
  const completed = await readCompletedHpoiImage(id);
  if (completed) {
    await publishHpoiImage(id, completed);
    return completed;
  }
  // A versioned migration consumes old rankings/original objects once. Refreshing an
  // existing v2 ID exits above and never re-downloads galleries or runs CV.
  const legacy = (await legacyManifest())[id];
  const reviewed = reviewedHpoiOriginals[id];
  const candidates = legacy?.candidates ?? [];
  let coverUrl = legacy?.coverUrl;
  let score = legacy?.score ?? null;
  const unavailable = [...(legacy?.unavailable ?? [])];
  if (!candidates.length) {
    const gallery = await readHpoiGallery(id);
    coverUrl = gallery.cover;
    score = gallery.score;
    const cover = await readHpoiSource(gallery.cover);
    for (const url of gallery.urls) {
      const preview = await readHpoiCandidate(url);
      if (!preview) {
        unavailable.push(url);
        continue;
      }
      const match = await matchCover(cover, preview);
      candidates.push({ url, similarity: match.score, ssim: match.ssim, psnr: match.psnr, scoring: 'ssim80-psnr20-v1' });
    }
  }
  const selected = reviewed?.url ?? [...candidates].sort((a, b) => b.similarity - a.similarity)[0]?.url;
  if (!selected || !coverUrl) throw new Error('Hpoi gallery has no available original; retry later');
  const previousWinner = legacy?.candidates.toSorted((a, b) => b.similarity - a.similarity)[0]?.url;
  const saved =
    legacy?.originalKey && selected === previousWinner && /\.jpe?g$/i.test(new URL(selected).pathname)
      ? await hpoiImageStorage().get(legacy.originalKey)
      : null;
  // No confidence/dimension gate may silently substitute /cover/n/ or /pic/s/.
  // Keep the original bytes even when the source itself is smaller than other figures.
  const bytes = saved ? Buffer.from(saved.bytes) : await readHpoiSource(selected);
  const original = await cacheHpoiOriginal(selected, bytes, reviewed?.crop);
  const record: CachedHpoiImage = {
    ...original,
    coverUrl,
    score,
    matched: true,
    processedAt: new Date().toISOString(),
    candidates,
    unavailable,
  };
  await publishHpoiImage(id, record);
  return record;
}

/** Idempotent per figure: completed original images are never rematched. */
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
