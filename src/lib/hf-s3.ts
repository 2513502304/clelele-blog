import { createHash, createHmac } from 'node:crypto';

const DEFAULT_REQUEST_ATTEMPTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export interface HfS3Config {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: URL;
  bucket: string;
  prefix: string;
  region: string;
}

export interface HfS3ObjectSnapshot {
  bytes: Uint8Array;
  etag: string | null;
  contentType: string | null;
  contentLength: number | null;
}

export class HfS3ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HfS3ConflictError';
  }
}

export class HfS3RequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HfS3RequestError';
  }
}

function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function compareUtf8Bytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
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

function signingKey(secret: string, date: string, region: string): Buffer {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

function formatDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

export function normalizeHfS3Prefix(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

export function getHfS3ObjectPath(config: HfS3Config, key: string): string {
  return [
    config.endpoint.pathname.replace(/^\/+|\/+$/g, ''),
    config.bucket,
    normalizeHfS3Prefix(config.prefix),
    key.replace(/^\/+/, ''),
  ]
    .filter(Boolean)
    .join('/');
}

export function createHfS3PresignedUrl(
  config: HfS3Config,
  method: 'GET' | 'PUT',
  key: string,
  expires: number,
  now = new Date(),
): string {
  const { amzDate, dateStamp } = formatDate(now);
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const canonicalUri = encodePath(`/${getHfS3ObjectPath(config, key)}`);
  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  });
  const canonicalQuery = [...query]
    .map(([name, value]) => [rfc3986Encode(name), rfc3986Encode(value)] as const)
    .sort(
      ([leftName, leftValue], [rightName, rightValue]) =>
        compareUtf8Bytes(leftName, rightName) || compareUtf8Bytes(leftValue, rightValue),
    )
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${config.endpoint.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const requestHash = createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, requestHash].join('\n');
  const signature = createHmac('sha256', signingKey(config.secretAccessKey, dateStamp, config.region))
    .update(stringToSign)
    .digest('hex');
  return `${config.endpoint.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function createHfS3SignedHeaders(
  config: HfS3Config,
  method: 'DELETE' | 'GET' | 'HEAD' | 'PUT',
  key: string,
  body: Uint8Array,
  contentType = 'application/octet-stream',
  conditions: { ifMatch?: string; ifNoneMatch?: '*' } = {},
  now = new Date(),
): { url: string; headers: Record<string, string> } {
  const payloadHash = createHash('sha256').update(body).digest('hex');
  const { amzDate, dateStamp } = formatDate(now);
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const canonicalUri = encodePath(`/${getHfS3ObjectPath(config, key)}`);
  const headers: Record<string, string> = {
    host: config.endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (method === 'PUT') headers['content-type'] = contentType;
  if (conditions.ifMatch) headers['if-match'] = conditions.ifMatch;
  if (conditions.ifNoneMatch) headers['if-none-match'] = conditions.ifNoneMatch;
  const sortedHeaders = Object.entries(headers).sort(([left], [right]) => compareUtf8Bytes(left, right));
  const signedHeaders = sortedHeaders.map(([name]) => name).join(';');
  const canonicalHeaders = sortedHeaders.map(([name, value]) => `${name}:${value}\n`).join('');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const requestHash = createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, requestHash].join('\n');
  const signature = createHmac('sha256', signingKey(config.secretAccessKey, dateStamp, config.region))
    .update(stringToSign)
    .digest('hex');
  return {
    url: `${config.endpoint.origin}${canonicalUri}`,
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

function isRetryable(error: unknown): boolean {
  if (error instanceof HfS3RequestError) return error.retryable;
  return error instanceof TypeError || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name));
}

async function responseError(response: Response, prefix: string): Promise<HfS3RequestError> {
  const detail = await response.text().catch(() => '');
  return new HfS3RequestError(
    `${prefix}: ${response.status}${detail ? ` ${detail}` : ''}`,
    response.status === 408 || response.status === 429 || response.status >= 500,
    response.status,
  );
}

async function retry<T>(label: string, operation: () => Promise<T>, attempts = DEFAULT_REQUEST_ATTEMPTS): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 150)));
    }
  }
  if (lastError instanceof HfS3ConflictError || lastError instanceof HfS3RequestError) throw lastError;
  throw new Error(`${label} failed after ${attempts} attempt(s).`, { cause: lastError });
}

export function createHfS3Client(
  config: HfS3Config,
  options: { attempts?: number; requestTimeoutMs?: number; transferTimeoutMs?: number } = {},
) {
  const attempts = options.attempts ?? DEFAULT_REQUEST_ATTEMPTS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const transferTimeoutMs = options.transferTimeoutMs ?? 60_000;
  async function putObject(
    key: string,
    body: Uint8Array,
    contentType: string,
    conditions: { ifMatch?: string; ifNoneMatch?: '*' } = {},
  ): Promise<string | null> {
    const requestBody = body.slice().buffer;
    return retry(
      `upload HF S3 object "${key}"`,
      async () => {
        const signed = createHfS3SignedHeaders(config, 'PUT', key, body, contentType, conditions);
        const response = await fetch(signed.url, {
          method: 'PUT',
          headers: signed.headers,
          body: requestBody,
          signal: AbortSignal.timeout(transferTimeoutMs),
        });
        if (response.status === 412) throw new HfS3ConflictError(`HF S3 object changed: ${key}`);
        if (!response.ok) throw await responseError(response, `Failed to upload HF S3 object "${key}"`);
        return response.headers.get('etag');
      },
      attempts,
    );
  }
  return {
    presign(method: 'GET' | 'PUT', key: string, expires: number, now = new Date()) {
      return createHfS3PresignedUrl(config, method, key, expires, now);
    },
    async put(
      key: string,
      body: Uint8Array,
      contentType: string,
      conditions: { ifMatch?: string; ifNoneMatch?: '*' } = {},
    ): Promise<void> {
      await putObject(key, body, contentType, conditions);
    },
    /** 条件更新调用方可复用响应 ETag，后续写入无需再次下载同一对象。 */
    async putWithEtag(
      key: string,
      body: Uint8Array,
      contentType: string,
      conditions: { ifMatch?: string; ifNoneMatch?: '*' } = {},
    ): Promise<string | null> {
      return putObject(key, body, contentType, conditions);
    },
    async head(key: string): Promise<{ exists: boolean; size: number | null; etag: string | null }> {
      return retry(
        `check HF S3 object "${key}"`,
        async () => {
          const signed = createHfS3SignedHeaders(config, 'HEAD', key, new Uint8Array());
          const response = await fetch(signed.url, {
            method: 'HEAD',
            headers: signed.headers,
            cache: 'no-store',
            signal: AbortSignal.timeout(requestTimeoutMs),
          });
          if (response.status === 404) return { exists: false, size: null, etag: null };
          if (!response.ok) throw await responseError(response, `Failed to check HF S3 object "${key}"`);
          const rawLength = response.headers.get('content-length');
          return {
            exists: true,
            size: rawLength === null ? null : Number.parseInt(rawLength, 10),
            etag: response.headers.get('etag'),
          };
        },
        attempts,
      );
    },
    async get(key: string, missingStatuses: readonly number[] = [404]): Promise<HfS3ObjectSnapshot | null> {
      return retry(
        `read HF S3 object "${key}"`,
        async () => {
          const response = await fetch(createHfS3PresignedUrl(config, 'GET', key, 60 * 60, new Date()), {
            cache: 'no-store',
            signal: AbortSignal.timeout(transferTimeoutMs),
          });
          if (missingStatuses.includes(response.status)) return null;
          if (!response.ok) throw await responseError(response, `Failed to read HF S3 object "${key}"`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          const rawLength = response.headers.get('content-length');
          return {
            bytes,
            etag: response.headers.get('etag'),
            contentType: response.headers.get('content-type'),
            contentLength: rawLength === null ? null : Number.parseInt(rawLength, 10),
          };
        },
        attempts,
      );
    },
    async delete(key: string): Promise<void> {
      await retry(
        `delete HF S3 object "${key}"`,
        async () => {
          const signed = createHfS3SignedHeaders(config, 'DELETE', key, new Uint8Array());
          const response = await fetch(signed.url, {
            method: 'DELETE',
            headers: signed.headers,
            signal: AbortSignal.timeout(requestTimeoutMs),
          });
          if (!response.ok && response.status !== 404)
            throw await responseError(response, `Failed to delete HF S3 object "${key}"`);
        },
        attempts,
      );
    },
  };
}
