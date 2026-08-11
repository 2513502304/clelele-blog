import { createHfS3Client, type HfS3Config, HfS3ConflictError } from './hf-s3';

const DEFAULT_ENDPOINT = 'https://s3.hf.co/clelele0722';
const DEFAULT_BUCKET = 'raw-datasets';
const DEFAULT_PREFIX = 'image-style-prompt-gallery';
const DEFAULT_REGION = 'us-east-1';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24;
const MAX_TTL_SECONDS = 60 * 60 * 24 * 7;
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
 * 很短的自定义 TTL 保留一半有效期作为余量；默认 24 小时 TTL 保留 5 分钟余量。
 */
export function getStyleGallerySignedImageRedirectCacheSeconds(ttlSeconds = getTtlSeconds()): number {
  if (ttlSeconds <= 2) return 0;
  const safetySeconds = Math.min(SIGNED_URL_CACHE_SAFETY_SECONDS, Math.max(1, Math.floor(ttlSeconds / 2)));
  return ttlSeconds - safetySeconds;
}

function getConfig(): HfS3Config {
  const accessKeyId = process.env.HF_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.HF_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing HF S3 credentials. Set HF_S3_ACCESS_KEY_ID and HF_S3_SECRET_ACCESS_KEY.');
  }
  return {
    accessKeyId,
    secretAccessKey,
    endpoint: new URL(process.env.HF_S3_ENDPOINT ?? DEFAULT_ENDPOINT),
    bucket: process.env.HF_S3_BUCKET ?? DEFAULT_BUCKET,
    prefix: process.env.STYLE_GALLERY_BUCKET_PREFIX ?? DEFAULT_PREFIX,
    region: process.env.HF_S3_REGION ?? DEFAULT_REGION,
  };
}

function client(timeoutMs?: number) {
  return createHfS3Client(getConfig(), timeoutMs ? { transferTimeoutMs: timeoutMs } : undefined);
}

export function createStyleGallerySignedImageUrl(key: string, now = new Date()): string {
  return client().presign('GET', key, getTtlSeconds(), now);
}

export function createStyleGallerySignedUploadUrl(key: string, now = new Date()): string {
  return client().presign('PUT', key, DEFAULT_UPLOAD_TTL_SECONDS, now);
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
    return await client().putWithEtag(key, body, contentType, conditions);
  } catch (error) {
    if (error instanceof HfS3ConflictError) throw new StyleGalleryObjectConflictError(error.message);
    throw error;
  }
}

export async function headStyleGalleryObject(key: string): Promise<boolean> {
  try {
    return (await client().head(key)).exists;
  } catch (error) {
    const cause = error instanceof Error ? error.cause : null;
    if (cause instanceof Error && /: 403(?:\s|$)/.test(cause.message)) return false;
    throw error;
  }
}

/** 只读取对象 ETag，用于在不下载正文的前提下校验短期缓存是否仍为最新版本。 */
export async function getStyleGalleryObjectEtag(key: string): Promise<string | null> {
  const result = await client().head(key);
  return result.exists ? result.etag : null;
}

export async function deleteStyleGalleryObject(key: string): Promise<void> {
  await client().delete(key);
}

export async function getStyleGalleryObjectText(key: string): Promise<string | null> {
  const result = await client(10_000).get(key, [403, 404]);
  return result ? new TextDecoder().decode(result.bytes) : null;
}

export async function getStyleGalleryObjectTextSnapshot(
  key: string,
  timeoutMs = 10_000,
): Promise<{ text: string | null; etag: string | null }> {
  const result = await client(timeoutMs).get(key, [403, 404]);
  return result ? { text: new TextDecoder().decode(result.bytes), etag: result.etag } : { text: null, etag: null };
}

export async function getStyleGalleryObjectBytes(key: string, timeoutMs = 60_000): Promise<Uint8Array | null> {
  return (await client(timeoutMs).get(key, [403, 404]))?.bytes ?? null;
}
