import { createHash, randomUUID } from 'node:crypto';
import { createHfS3Client, HfS3ConflictError } from '../hf-s3';
import { type SiteAsset, type SiteProfile, siteProfileSchema } from './schema';

const KEY = 'profile.v1.json';
let cache: { value: SiteProfile; until: number } | undefined;
let pending: Promise<SiteProfile> | undefined;
let epoch = 0;

/** Separate namespace, shared HF credentials; no provider receipts or login data are publicly addressable. */
export function siteProfileStorage() {
  const accessKeyId = process.env.HF_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.HF_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error('HF storage is not configured.');
  return createHfS3Client({
    accessKeyId,
    secretAccessKey,
    endpoint: new URL(process.env.HF_S3_ENDPOINT ?? 'https://s3.hf.co/clelele0722'),
    bucket: process.env.HF_S3_BUCKET ?? 'raw-datasets',
    prefix: process.env.SITE_PROFILE_BUCKET_PREFIX ?? 'site-profile',
    region: process.env.HF_S3_REGION ?? 'us-east-1',
  });
}
async function snapshot() {
  const object = await siteProfileStorage().get(KEY);
  if (!object) return null;
  return { value: siteProfileSchema.parse(JSON.parse(new TextDecoder().decode(object.bytes))), etag: object.etag };
}
export function getSiteProfile(fresh = false): Promise<SiteProfile> {
  if (!fresh && cache && cache.until > Date.now()) return Promise.resolve(cache.value);
  if (!fresh && pending) return pending;
  const version = epoch;
  const task = snapshot().then((record) => {
    if (!record) throw new Error('Site profile has not been initialized.');
    if (epoch === version) cache = { value: record.value, until: Date.now() + 30_000 };
    return record.value;
  });
  if (!fresh) {
    pending = task;
    void task
      .finally(() => {
        if (pending === task) pending = undefined;
      })
      .catch(() => {});
  }
  return task;
}
/** Read-check-write with ETag: stale editors cannot silently erase another tab's changes. */
export async function saveSiteProfile(
  expectedRevision: string | null,
  mutation: (current: SiteProfile | null) => SiteProfile,
): Promise<SiteProfile> {
  const current = await snapshot();
  if ((current?.value.revision ?? null) !== expectedRevision)
    throw new HfS3ConflictError('资料已在其他窗口更新，请重新载入后编辑。');
  if (current && !current.etag) throw new Error('HF did not return an ETag; refusing an unconditional update.');
  const next = siteProfileSchema.parse({
    ...mutation(current?.value ?? null),
    revision: randomUUID(),
    updatedAt: new Date().toISOString(),
  });
  const bytes = Buffer.from(JSON.stringify(next));
  // Assets are immutable and uploaded first. A failed metadata save leaves no broken public reference.
  try {
    await siteProfileStorage().put(
      KEY,
      bytes,
      'application/json',
      current?.etag ? { ifMatch: current.etag } : { ifNoneMatch: '*' },
    );
  } catch (error) {
    const observed = await snapshot();
    if (observed?.value.revision !== next.revision) throw error;
  }
  epoch++;
  pending = undefined;
  cache = { value: next, until: Date.now() + 30_000 };
  return next;
}
/** Validate decoded raster data before saving; SVG/HTML never enter the public asset namespace. */
export async function uploadSiteAsset(bytes: Uint8Array, name: string): Promise<SiteAsset> {
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('图片大小须为 1 字节至 20 MB。');
  const { default: sharp } = await import('sharp');
  const meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
  const extensions: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' };
  const extension = extensions[meta.format ?? ''];
  if (!extension || !meta.width || !meta.height) throw new Error('请选择 JPEG、PNG、WebP 或 GIF 图片。');
  const key = `images/${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
  if (!(await siteProfileStorage().head(key)).exists) await siteProfileStorage().put(key, bytes, `image/${meta.format}`);
  return { key, name: name.slice(0, 255), uploadedAt: new Date().toISOString(), width: meta.width, height: meta.height };
}
