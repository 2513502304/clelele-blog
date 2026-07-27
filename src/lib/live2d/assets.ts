import { createHfS3PresignedUrl, type HfS3Config } from '../hf-s3';
import type { Live2DAssetDescriptor } from './asset-registry';

export type {
  Live2DAssetDescriptor,
  Live2DAssetPathErrorCode,
} from './asset-registry';
export {
  getLive2DPackageManifest,
  LIVE2D_MAX_ASSET_BYTES,
  Live2DAssetPathError,
  normalizeLive2DAssetKey,
  resolveLive2DAsset,
  resolveLive2DAssetWithManifest,
  resolveLive2DPackageAsset,
} from './asset-registry';

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const DEFAULT_ORIGIN_ATTEMPTS = 3;
// A single object must fail early enough for the existing retry loop to recover before the
// renderer's whole-package deadline. Published package members are capped and currently < 1 MB.
const DEFAULT_ORIGIN_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_CONCURRENT_READS = 6;
const DEFAULT_MAX_QUEUED_READS = 24;

export const LIVE2D_BROWSER_CACHE_CONTROL = IMMUTABLE_CACHE_CONTROL;
export const LIVE2D_CDN_CACHE_CONTROL = IMMUTABLE_CACHE_CONTROL;

export class Live2DReadCredentialsError extends Error {
  constructor() {
    super('Live2D HF read credentials are not configured.');
    this.name = 'Live2DReadCredentialsError';
  }
}

export function createLive2DAssetHeaders(asset: Live2DAssetDescriptor): Headers {
  return new Headers({
    'cache-control': LIVE2D_BROWSER_CACHE_CONTROL,
    'content-length': String(asset.size),
    'content-type': asset.mime,
    etag: `"sha256-${asset.sha256}"`,
    'referrer-policy': 'no-referrer',
    'vercel-cdn-cache-control': LIVE2D_CDN_CACHE_CONTROL,
    'x-content-type-options': 'nosniff',
  });
}

export function getLive2DReadS3Config(env: Record<string, string | undefined>): HfS3Config {
  const accessKeyId = env.LIVE2D_HF_S3_READ_ACCESS_KEY_ID;
  const secretAccessKey = env.LIVE2D_HF_S3_READ_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Live2DReadCredentialsError();
  return {
    accessKeyId,
    secretAccessKey,
    endpoint: new URL(env.LIVE2D_HF_S3_ENDPOINT ?? 'https://s3.hf.co/clelele0722'),
    bucket: env.LIVE2D_HF_S3_BUCKET ?? 'raw-datasets',
    prefix: env.LIVE2D_HF_S3_PREFIX ?? 'bestdori',
    region: env.LIVE2D_HF_S3_REGION ?? 'us-east-1',
  };
}

export class Live2DOriginError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'Live2DOriginError';
  }
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isTransientFetchError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError'))
  );
}

function createExpectedLengthStream(body: ReadableStream<Uint8Array>, expected: number): ReadableStream<Uint8Array> {
  let received = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > expected) {
          controller.error(new Error('Live2D origin returned more bytes than the immutable manifest declares.'));
          return;
        }
        controller.enqueue(chunk);
      },
      flush(controller) {
        if (received !== expected) {
          controller.error(new Error('Live2D origin byte count does not match the immutable manifest.'));
        }
      },
    }),
  );
}

function responseWithTransferDeadline(
  response: Response,
  asset: Live2DAssetDescriptor,
  controller: AbortController,
  timeoutId: ReturnType<typeof setTimeout>,
  releasePermit: () => void,
): Response {
  const finish = () => {
    clearTimeout(timeoutId);
    releasePermit();
  };
  if (!response.body) {
    finish();
    throw new Live2DOriginError('Live2D origin returned an empty response body.', false);
  }
  const reader = createExpectedLengthStream(response.body, asset.size).getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(streamController) {
      try {
        const result = await reader.read();
        if (result.done) {
          finish();
          streamController.close();
        } else {
          streamController.enqueue(result.value);
        }
      } catch (error) {
        finish();
        streamController.error(error);
      }
    },
    async cancel(reason) {
      controller.abort(reason);
      finish();
      await reader.cancel(reason).catch(() => undefined);
    },
  });
  return new Response(body, { status: 200, headers: response.headers });
}

function createConcurrencyGate(
  limit: number,
  maxQueued: number,
): {
  acquire: (signal?: AbortSignal) => Promise<() => void>;
  readonly pendingCount: number;
} {
  let active = 0;
  const queue: Array<{
    resolve: () => void;
    reject: (reason?: unknown) => void;
    signal?: AbortSignal;
    abort?: () => void;
  }> = [];

  function handOff(): void {
    const next = queue.shift();
    if (!next) {
      active -= 1;
      return;
    }
    if (next.abort) next.signal?.removeEventListener('abort', next.abort);
    next.resolve();
  }

  return {
    async acquire(signal) {
      signal?.throwIfAborted();
      let inherited = false;
      if (active >= limit) {
        if (queue.length >= maxQueued) {
          throw new Live2DOriginError('Live2D origin read queue is full.', true, 503);
        }
        await new Promise<void>((resolve, reject) => {
          const entry = { resolve, reject, signal } as (typeof queue)[number];
          const abort = () => {
            const index = queue.indexOf(entry);
            if (index >= 0) queue.splice(index, 1);
            reject(signal?.reason);
          };
          entry.abort = abort;
          signal?.addEventListener('abort', abort, { once: true });
          queue.push(entry);
        });
        inherited = true;
      }
      if (signal?.aborted) {
        if (inherited) handOff();
        signal.throwIfAborted();
      }
      if (!inherited) active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        handOff();
      };
    },
    get pendingCount() {
      return active + queue.length;
    },
  };
}

export interface Live2DAssetOriginReaderOptions {
  config: () => HfS3Config;
  fetch?: typeof fetch;
  attempts?: number;
  timeoutMs?: number;
  maxConcurrentReads?: number;
  maxQueuedReads?: number;
  retryDelay?: (attempt: number) => Promise<void>;
}

export interface Live2DAssetOriginReader {
  read(asset: Live2DAssetDescriptor, signal?: AbortSignal): Promise<Response>;
  verify(asset: Live2DAssetDescriptor, signal?: AbortSignal): Promise<void>;
  readonly inFlightCount: number;
}

/**
 * 每个访客流独立拥有回源请求；并发和排队均有上限，断开后会释放对应槽位。
 * immutable CDN/browser cache 负责正常命中，避免在 Function 内用 Response tee 缓冲慢消费者。
 */
export function createLive2DAssetOriginReader(options: Live2DAssetOriginReaderOptions): Live2DAssetOriginReader {
  const fetchImpl = options.fetch ?? fetch;
  const attempts = options.attempts ?? DEFAULT_ORIGIN_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_ORIGIN_TIMEOUT_MS;
  const retryDelay = options.retryDelay ?? ((attempt) => new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt)));
  const gate = createConcurrencyGate(
    options.maxConcurrentReads ?? DEFAULT_MAX_CONCURRENT_READS,
    options.maxQueuedReads ?? DEFAULT_MAX_QUEUED_READS,
  );

  async function readFromOrigin(asset: Live2DAssetDescriptor, requestSignal?: AbortSignal): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const releasePermit = await gate.acquire(requestSignal);
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(new DOMException('Live2D origin timed out.', 'TimeoutError')),
        timeoutMs,
      );
      try {
        const config = options.config();
        const signedUrl = createHfS3PresignedUrl(config, 'GET', asset.key, 300);
        const response = await fetchImpl(signedUrl, {
          cache: 'no-store',
          // HF Bucket objects currently redirect to its CAS bridge. The signed URL remains server-side,
          // while manifest MIME/length checks and the streaming byte counter validate the final response.
          redirect: 'follow',
          referrerPolicy: 'no-referrer',
          signal: requestSignal ? AbortSignal.any([controller.signal, requestSignal]) : controller.signal,
        });
        if (!response.ok) {
          clearTimeout(timeoutId);
          releasePermit();
          const error = new Live2DOriginError(
            `Live2D origin request failed with status ${response.status}.`,
            isTransientStatus(response.status),
            response.status === 404 ? 404 : 502,
          );
          await response.body?.cancel().catch(() => undefined);
          throw error;
        }
        const contentLength = response.headers.get('content-length');
        if (contentLength !== null && Number.parseInt(contentLength, 10) !== asset.size) {
          clearTimeout(timeoutId);
          releasePermit();
          await response.body?.cancel().catch(() => undefined);
          throw new Live2DOriginError('Live2D origin content length does not match the immutable manifest.', false);
        }
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
        // HF CAS omits Content-Type for some binary objects. A present but conflicting value is rejected;
        // the same-origin response always publishes the immutable manifest MIME with nosniff.
        if (contentType && contentType !== asset.mime.toLowerCase()) {
          clearTimeout(timeoutId);
          releasePermit();
          await response.body?.cancel().catch(() => undefined);
          throw new Live2DOriginError('Live2D origin content type does not match the immutable manifest.', false);
        }
        return responseWithTransferDeadline(response, asset, controller, timeoutId, releasePermit);
      } catch (error) {
        clearTimeout(timeoutId);
        releasePermit();
        lastError = error;
        if (requestSignal?.aborted) throw requestSignal.reason;
        const retryable = error instanceof Live2DOriginError ? error.retryable : isTransientFetchError(error);
        if (!retryable || attempt + 1 >= attempts) break;
        await retryDelay(attempt);
      }
    }
    if (lastError instanceof Live2DOriginError || lastError instanceof Live2DReadCredentialsError) throw lastError;
    throw new Live2DOriginError('Live2D origin request failed.', false, 502);
  }

  return {
    read(asset, signal) {
      return readFromOrigin(asset, signal);
    },
    async verify(asset, signal) {
      // GET is used because HF's CAS redirect behavior is not uniform for HEAD. Cancelling immediately
      // verifies credentials, object existence and immutable headers without buffering the package member.
      const response = await readFromOrigin(asset, signal);
      await response.body?.cancel().catch(() => undefined);
    },
    get inFlightCount() {
      return gate.pendingCount;
    },
  };
}
