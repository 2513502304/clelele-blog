import { createHash, createHmac } from 'node:crypto';

const DEFAULT_ENDPOINT = 'https://s3.hf.co/clelele0722';
const DEFAULT_BUCKET = 'raw-datasets';
const DEFAULT_PREFIX = 'image-style-prompt-gallery';
const DEFAULT_REGION = 'us-east-1';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24;
const MAX_TTL_SECONDS = 60 * 60 * 24 * 7;
const DEFAULT_UPLOAD_TTL_SECONDS = 15 * 60;
const REQUEST_TIMEOUT_MS = 10_000;
const OBJECT_TRANSFER_TIMEOUT_MS = 60_000;
const REQUEST_ATTEMPTS = 3;

interface HfS3Config {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: URL;
  bucket: string;
  prefix: string;
  region: string;
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

function getHfS3Config(): HfS3Config {
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
    prefix: (process.env.STYLE_GALLERY_BUCKET_PREFIX ?? DEFAULT_PREFIX).replace(/^\/+|\/+$/g, ''),
    region: process.env.HF_S3_REGION ?? DEFAULT_REGION,
  };
}

function getObjectPath(config: HfS3Config, key: string): string {
  return [config.endpoint.pathname.replace(/^\/+|\/+$/g, ''), config.bucket, config.prefix, key.replace(/^\/+/, '')]
    .filter(Boolean)
    .join('/');
}

function createPresignedUrl(method: 'GET' | 'PUT', key: string, expires: number, now = new Date()): string {
  const config = getHfS3Config();
  const { amzDate, dateStamp } = formatAmzDate(now);
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const objectPath = getObjectPath(config, key);
  const canonicalUri = encodePath(`/${objectPath}`);
  const host = config.endpoint.host;

  const queryParams = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expires.toString(),
    'X-Amz-SignedHeaders': 'host',
  });

  const canonicalQuery = [...queryParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${rfc3986Encode(name)}=${rfc3986Encode(value)}`)
    .join('&');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const canonicalRequestHash = createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, canonicalRequestHash];
  const signature = hmacHex(getSigningKey(config.secretAccessKey, dateStamp, config.region), stringToSign.join('\n'));

  return `${config.endpoint.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function createStyleGallerySignedImageUrl(key: string, now = new Date()): string {
  return createPresignedUrl('GET', key, getTtlSeconds(), now);
}

export function createStyleGallerySignedUploadUrl(key: string, now = new Date()): string {
  return createPresignedUrl('PUT', key, DEFAULT_UPLOAD_TTL_SECONDS, now);
}

function createSignedHeaders(
  method: 'DELETE' | 'GET' | 'HEAD' | 'PUT',
  key: string,
  body: Uint8Array,
  contentType = 'application/octet-stream',
  now = new Date(),
): { url: string; headers: Record<string, string> } {
  const config = getHfS3Config();
  const payloadHash = createHash('sha256').update(body).digest('hex');
  const { amzDate, dateStamp } = formatAmzDate(now);
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const objectPath = getObjectPath(config, key);
  const canonicalUri = encodePath(`/${objectPath}`);
  const host = config.endpoint.host;
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (method === 'PUT') headers['content-type'] = contentType;
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.entries(headers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}:${value}\n`)
    .join('');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const canonicalRequestHash = createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, canonicalRequestHash].join('\n');
  const signature = hmacHex(getSigningKey(config.secretAccessKey, dateStamp, config.region), stringToSign);

  return {
    url: `${config.endpoint.origin}${canonicalUri}`,
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

export async function putStyleGalleryObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const requestBody = new ArrayBuffer(body.byteLength);
  new Uint8Array(requestBody).set(body);
  await withRequestRetry(`upload HF S3 object "${key}"`, async () => {
    const signed = createSignedHeaders('PUT', key, body, contentType);
    const response = await fetch(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body: requestBody,
      signal: AbortSignal.timeout(OBJECT_TRANSFER_TIMEOUT_MS),
    });
    if (!response.ok) throw await createRequestError(response, `Failed to upload HF S3 object "${key}"`);
  });
}

export async function headStyleGalleryObject(key: string): Promise<boolean> {
  return withRequestRetry(`check HF S3 object "${key}"`, async () => {
    const signed = createSignedHeaders('HEAD', key, new Uint8Array());
    const response = await fetch(signed.url, {
      method: 'HEAD',
      headers: signed.headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404 || response.status === 403) return false;
    if (!response.ok) throw await createRequestError(response, `Failed to check HF S3 object "${key}"`);
    return true;
  });
}

export async function deleteStyleGalleryObject(key: string): Promise<void> {
  await withRequestRetry(`delete HF S3 object "${key}"`, async () => {
    const signed = createSignedHeaders('DELETE', key, new Uint8Array());
    const response = await fetch(signed.url, {
      method: 'DELETE',
      headers: signed.headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok && response.status !== 404) {
      throw await createRequestError(response, `Failed to delete HF S3 object "${key}"`);
    }
  });
}

export async function getStyleGalleryObjectText(key: string): Promise<string | null> {
  return withRequestRetry(`read HF S3 object "${key}"`, async () => {
    const response = await fetch(createStyleGallerySignedImageUrl(key), {
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok) throw await createRequestError(response, `Failed to read HF S3 object "${key}"`);
    return response.text();
  });
}

class RetryableRequestError extends Error {
  retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'RetryableRequestError';
    this.retryable = retryable;
  }
}

async function createRequestError(response: Response, prefix: string): Promise<RetryableRequestError> {
  const detail = await response.text().catch(() => '');
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  return new RetryableRequestError(`${prefix}: ${response.status}${detail ? ` ${detail}` : ''}`, retryable);
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof RetryableRequestError) return error.retryable;
  return error instanceof TypeError || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name));
}

async function withRequestRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  let attempts = 0;
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === REQUEST_ATTEMPTS) break;
      const delay = 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 150);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempt(s).`, { cause: lastError });
}
