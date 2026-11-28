import { createHfS3Client, fetchHfS3Read, type HfS3Config, HfS3ConflictError, HfS3RequestError } from './hf-s3';

const DEFAULT_ENDPOINT = 'https://s3.hf.co/clelele0722';
const DEFAULT_BUCKET = 'raw-datasets';
const DEFAULT_PREFIX = 'image-style-prompt-gallery';
const DEFAULT_REGION = 'us-east-1';
const MAX_TTL_SECONDS = 60 * 60 * 24 * 7;
const DEFAULT_TTL_SECONDS = MAX_TTL_SECONDS;
const DEFAULT_UPLOAD_TTL_SECONDS = 15 * 60;
const SIGNED_URL_CACHE_SAFETY_SECONDS = 5 * 60;

function getTtlSeconds(): number {
  const parsed = Number.parseInt(process.env.STYLE_GALLERY_SIGNED_URL_TTL_SECONDS ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.max(parsed, 1), MAX_TTL_SECONDS);
}

/** HF 图片域名只用于浏览器连接预热，不包含 bucket 路径或任何凭据。 */
export function getStyleGalleryImageStorageOrigin(): string {
  return new URL(process.env.HF_S3_ENDPOINT ?? DEFAULT_ENDPOINT).origin;
}

/**
 * 让 Vercel CDN 缓存图片重定向，同时确保缓存至少比预签名 URL 提前一段时间失效。
 * 很短的自定义 TTL 保留一半有效期作为余量；默认 7 天 TTL 保留 5 分钟余量。
 */
export function getStyleGallerySignedImageRedirectCacheSeconds(ttlSeconds = getTtlSeconds()): number {
  if (ttlSeconds <= 2) return 0;
  const safetySeconds = Math.min(SIGNED_URL_CACHE_SAFETY_SECONDS, Math.max(1, Math.floor(ttlSeconds / 2)));
  return ttlSeconds - safetySeconds;
}

const DRAFTS_BUCKET = 'gallery-studio-private';
const READY_MARKER = 'operations/gallery-drafts-ready-v1';

function isPrivateDraft(key: string): boolean {
  if (key.split('/').some((part) => !part || part === '.' || part === '..') || key.includes('\\')) {
    throw new Error('Invalid Gallery storage key.');
  }
  return key.startsWith('generation-drafts/');
}

function getConfig(privateDraft: boolean): HfS3Config {
  const accessKeyId = process.env.HF_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.HF_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing HF S3 credentials. Set HF_S3_ACCESS_KEY_ID and HF_S3_SECRET_ACCESS_KEY.');
  }
  const publicBucket = process.env.HF_S3_BUCKET ?? DEFAULT_BUCKET;
  const bucket = privateDraft ? (process.env.STYLE_GALLERY_DRAFTS_BUCKET ?? DRAFTS_BUCKET) : publicBucket;
  if (privateDraft && (!/^[a-z0-9][a-z0-9-]*$/.test(bucket) || bucket === publicBucket || bucket === DEFAULT_BUCKET))
    throw new Error('Gallery drafts require a dedicated private bucket.');
  return {
    accessKeyId,
    secretAccessKey,
    endpoint: new URL(process.env.HF_S3_ENDPOINT ?? DEFAULT_ENDPOINT),
    bucket,
    prefix: process.env.STYLE_GALLERY_BUCKET_PREFIX ?? DEFAULT_PREFIX,
    region: process.env.HF_S3_REGION ?? DEFAULT_REGION,
  };
}

// A newly rolled out process must not interpret a partially copied manifest as an
// empty workspace. Only a successful marker check is reused across requests.
const ready = new Map<string, Promise<void>>();
async function withObject<T>(
  key: string,
  use: (storage: ReturnType<typeof createHfS3Client>, privateDraft: boolean) => Promise<T>,
  timeoutMs?: number,
): Promise<T> {
  const privateDraft = isPrivateDraft(key);
  const config = getConfig(privateDraft);
  const storage = createHfS3Client(config, timeoutMs ? { transferTimeoutMs: timeoutMs } : undefined);
  if (privateDraft) {
    const scope = JSON.stringify([config.endpoint.href, config.bucket, config.prefix]);
    let check = ready.get(scope);
    if (!check) {
      check = storage
        .head(READY_MARKER)
        .then(({ exists }) => {
          if (!exists) throw new Error('Gallery draft storage is awaiting migration verification.');
        })
        .catch((error) => {
          ready.delete(scope);
          throw error;
        });
      ready.set(scope, check);
    }
    await check;
  }
  return use(storage, privateDraft);
}

function publicKey(key: string): string {
  if (isPrivateDraft(key)) throw new Error('Private Gallery drafts require an authenticated preview.');
  return key;
}

/** Stream the authorized original through the server. The browser never receives its storage URL. */
export async function fetchStyleGalleryDraftOriginal(key: string): Promise<Response> {
  if (!isPrivateDraft(key)) throw new Error('Expected a Gallery draft key.');
  return withObject(key, (storage) => fetchHfS3Read(storage.presign('GET', key, 300), { signal: AbortSignal.timeout(60_000) }));
}

export function createStyleGallerySignedImageUrl(key: string, now = new Date()): string {
  return createHfS3Client(getConfig(false)).presign('GET', publicKey(key), getTtlSeconds(), now);
}

/** Lightbox 批量签名复用一次配置解析和 S3 client，避免每张图重复构造签名上下文。 */
export function createStyleGallerySignedImageUrls(keys: readonly string[], now = new Date()): Record<string, string> {
  const signer = createHfS3Client(getConfig(false));
  const ttlSeconds = getTtlSeconds();
  return Object.fromEntries(keys.map((key) => [key, signer.presign('GET', publicKey(key), ttlSeconds, now)]));
}

export function createStyleGallerySignedUploadUrl(key: string, now = new Date()): string {
  return createHfS3Client(getConfig(false)).presign('PUT', publicKey(key), DEFAULT_UPLOAD_TTL_SECONDS, now);
}

export class StyleGalleryObjectConflictError extends HfS3ConflictError {
  constructor(message: string) {
    super(message);
    this.name = 'StyleGalleryObjectConflictError';
  }
}

export interface StyleGalleryObjectWriteConditions {
  ifMatch?: string;
  ifNoneMatch?: '*';
}

export async function putStyleGalleryObject(
  key: string,
  body: Uint8Array,
  contentType: string,
  conditions: StyleGalleryObjectWriteConditions = {},
): Promise<string | null> {
  try {
    return await withObject(key, (storage) => storage.putWithEtag(key, body, contentType, conditions));
  } catch (error) {
    if (error instanceof HfS3ConflictError) throw new StyleGalleryObjectConflictError(error.message);
    throw error;
  }
}

export async function headStyleGalleryObject(key: string): Promise<boolean> {
  try {
    return (await withObject(key, (storage) => storage.head(key))).exists;
  } catch (error) {
    if (!isPrivateDraft(key) && error instanceof HfS3RequestError && error.status === 403) return false;
    throw error;
  }
}

/** 只读取对象 ETag，用于在不下载正文的前提下校验短期缓存是否仍为最新版本。 */
export async function getStyleGalleryObjectEtag(key: string): Promise<string | null> {
  const result = await withObject(key, (storage) => storage.head(key));
  return result.exists ? result.etag : null;
}

export async function deleteStyleGalleryObject(key: string): Promise<void> {
  await withObject(key, (storage) => storage.delete(key));
}

export async function getStyleGalleryObjectText(key: string): Promise<string | null> {
  const result = await getStyleGalleryObjectBytesSnapshot(key, 10_000);
  return result ? new TextDecoder().decode(result.bytes) : null;
}

export async function getStyleGalleryObjectTextSnapshot(
  key: string,
  timeoutMs = 10_000,
): Promise<{ text: string | null; etag: string | null }> {
  const result = await getStyleGalleryObjectBytesSnapshot(key, timeoutMs);
  return result ? { text: new TextDecoder().decode(result.bytes), etag: result.etag } : { text: null, etag: null };
}

/** Read the blob and its revision together for a conditional cache replacement. */
export async function getStyleGalleryObjectBytesSnapshot(key: string, timeoutMs = 60_000) {
  return withObject(key, (storage, privateDraft) => storage.get(key, privateDraft ? [404] : [403, 404]), timeoutMs);
}

export async function getStyleGalleryObjectBytes(key: string, timeoutMs = 60_000): Promise<Uint8Array | null> {
  return (await getStyleGalleryObjectBytesSnapshot(key, timeoutMs))?.bytes ?? null;
}
