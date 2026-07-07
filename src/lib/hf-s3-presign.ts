import { createHash, createHmac } from 'node:crypto';

const DEFAULT_ENDPOINT = 'https://s3.hf.co/clelele0722';
const DEFAULT_BUCKET = 'raw-datasets';
const DEFAULT_PREFIX = 'image-style-prompt-gallery';
const DEFAULT_REGION = 'us-east-1';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24;
const MAX_TTL_SECONDS = 60 * 60 * 24 * 7;

export function getStyleGalleryImagePath(kind: 'source' | 'thumb', fileName: string): string {
  return `/api/style-gallery/image/${kind}/${fileName}`;
}

function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodePath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => rfc3986Encode(segment))
    .join('/');
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function hmacHex(key: string | Buffer, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

function getSigningKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

function formatAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function getTtlSeconds(): number {
  const rawValue = process.env.STYLE_GALLERY_SIGNED_URL_TTL_SECONDS;
  const parsed = rawValue ? Number.parseInt(rawValue, 10) : DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.max(parsed, 1), MAX_TTL_SECONDS);
}

export function createStyleGallerySignedImageUrl(key: string, now = new Date()): string {
  const accessKeyId = process.env.HF_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.HF_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing HF S3 credentials. Set HF_S3_ACCESS_KEY_ID and HF_S3_SECRET_ACCESS_KEY.');
  }

  const endpoint = new URL(process.env.HF_S3_ENDPOINT ?? DEFAULT_ENDPOINT);
  const bucket = process.env.HF_S3_BUCKET ?? DEFAULT_BUCKET;
  const prefix = (process.env.STYLE_GALLERY_BUCKET_PREFIX ?? DEFAULT_PREFIX).replace(/^\/+|\/+$/g, '');
  const region = process.env.HF_S3_REGION ?? DEFAULT_REGION;
  const expires = getTtlSeconds();
  const { amzDate, dateStamp } = formatAmzDate(now);
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const objectPath = [endpoint.pathname.replace(/^\/+|\/+$/g, ''), bucket, prefix, key].filter(Boolean).join('/');
  const canonicalUri = encodePath(`/${objectPath}`);
  const host = endpoint.host;

  const queryParams = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expires.toString(),
    'X-Amz-SignedHeaders': 'host',
  });

  const canonicalQuery = [...queryParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${rfc3986Encode(name)}=${rfc3986Encode(value)}`)
    .join('&');
  const canonicalRequest = ['GET', canonicalUri, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const canonicalRequestHash = createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, canonicalRequestHash];
  const signature = hmacHex(getSigningKey(secretAccessKey, dateStamp, region), stringToSign.join('\n'));

  return `${endpoint.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
