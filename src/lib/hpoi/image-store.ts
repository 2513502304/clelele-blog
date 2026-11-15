import { createHfS3Client, HfS3ConflictError } from '../hf-s3';

export interface CachedHpoiImage {
  coverUrl: string;
  width: number;
  height: number;
  key: string;
  fallbackKey: string;
  score: string | null;
  matched: boolean;
  originalKey?: string;
  /** Selected /pic/n/ URL; the cached object's bytes must equal this source file. */
  sourceUrl?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  /** CSS viewport into a multi-photo poster, in original pixels; never a re-encoded derivative. */
  crop?: { left: number; top: number; width: number; height: number };
  /** Public gallery links whose thumbnail and original both returned 404. */
  unavailable?: string[];
  processedAt: string;
  /** Legacy similarity is SSIM-only; new entries retain both metrics and their scoring version. */
  candidates: Array<{ url: string; similarity: number; ssim?: number; psnr?: number; scoring?: 'ssim80-psnr20-v1' }>;
}
export type HpoiImageManifest = Record<string, CachedHpoiImage>;
const INDEX = 'manifest.v2.json';
let cached: { value: HpoiImageManifest; until: number } | undefined;
let pending: Promise<HpoiImageManifest> | undefined;

/** Isolated namespace: Hpoi synchronization never reads or writes Gallery objects. */
export function hpoiImageStorage() {
  const accessKeyId = process.env.HF_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.HF_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error('HF storage is not configured');
  return createHfS3Client({
    accessKeyId,
    secretAccessKey,
    endpoint: new URL(process.env.HF_S3_ENDPOINT ?? 'https://s3.hf.co/clelele0722'),
    bucket: process.env.HF_S3_BUCKET ?? 'raw-datasets',
    prefix: 'hpoi-images',
    region: process.env.HF_S3_REGION ?? 'us-east-1',
  });
}

/** One-time v1 migration reuses existing rankings and original objects, without repeating CV. */
export async function readLegacyHpoiImageManifest(): Promise<HpoiImageManifest> {
  const object = await hpoiImageStorage().get('manifest.v1.json');
  return object ? JSON.parse(Buffer.from(object.bytes).toString()) : {};
}

/** Coalesce manifest reads, including empty manifests. Failures never become a completed snapshot. */
export function readHpoiImageManifest(): Promise<HpoiImageManifest> {
  if (cached && cached.until > Date.now()) return Promise.resolve(cached.value);
  if (pending) return pending;
  pending = hpoiImageStorage()
    .get(INDEX)
    .then((object) => {
      const value = object ? (JSON.parse(Buffer.from(object.bytes).toString()) as HpoiImageManifest) : {};
      cached = { value, until: Date.now() + 60_000 };
      return value;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

/** Immutable per-ID receipts survive a stale manifest read or interruption before index publication. */
export async function readCompletedHpoiImage(id: string): Promise<CachedHpoiImage | null> {
  const object = await hpoiImageStorage().get(`completed-v2/${id}.json`);
  return object ? (JSON.parse(Buffer.from(object.bytes).toString()) as CachedHpoiImage) : null;
}

/** First completion wins; an index repair must reuse the original decision, not overwrite it. */
export async function ensureHpoiImageCompletion(id: string, record: CachedHpoiImage): Promise<CachedHpoiImage> {
  try {
    await hpoiImageStorage().put(`completed-v2/${id}.json`, Buffer.from(JSON.stringify(record)), 'application/json', {
      ifNoneMatch: '*',
    });
    return record;
  } catch (error) {
    if (!(error instanceof HfS3ConflictError)) throw error;
    const existing = await readCompletedHpoiImage(id);
    if (!existing) throw new Error('Completed Hpoi image receipt temporarily unavailable');
    return existing;
  }
}

/** Publish only after every referenced object exists; CAS merges concurrent batches without erasing entries. */
export async function publishHpoiImage(id: string, record: CachedHpoiImage): Promise<void> {
  record = await ensureHpoiImageCompletion(id, record);
  const client = hpoiImageStorage();
  for (let attempt = 0; attempt < 6; attempt++) {
    const snapshot = await client.get(INDEX);
    const value: HpoiImageManifest = snapshot ? JSON.parse(Buffer.from(snapshot.bytes).toString()) : {};
    if (value[id]) {
      cached = undefined;
      return;
    }
    if (snapshot && !snapshot.etag) throw new Error('Missing HF ETag');
    value[id] = record;
    try {
      await client.put(
        INDEX,
        Buffer.from(JSON.stringify(value)),
        'application/json',
        snapshot?.etag ? { ifMatch: snapshot.etag } : { ifNoneMatch: '*' },
      );
      cached = { value, until: Date.now() + 60_000 };
      return;
    } catch (error) {
      if (!(error instanceof HfS3ConflictError)) throw error;
    }
  }
  throw new Error('Hpoi image manifest remained busy');
}
