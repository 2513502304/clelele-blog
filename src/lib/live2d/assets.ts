import { createHfS3PresignedUrl, type HfS3Config } from '../hf-s3';
import type { Live2DAssetDescriptor } from './asset-registry';

export type { Live2DAssetDescriptor, Live2DAssetPathErrorCode } from './asset-registry';
export {
  getLive2DPackageManifest,
  LIVE2D_MAX_ASSET_BYTES,
  Live2DAssetPathError,
  normalizeLive2DAssetKey,
  resolveLive2DAsset,
  resolveLive2DPackageAsset,
} from './asset-registry';

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const DEFAULT_ORIGIN_ATTEMPTS = 3;
const DEFAULT_ORIGIN_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_CONCURRENT_READS = 6;
const COLD_READ_COALESCE_WINDOW_MS = 100;

export const LIVE2D_BROWSER_CACHE_CONTROL = IMMUTABLE_CACHE_CONTROL;
export const LIVE2D_CDN_CACHE_CONTROL = IMMUTABLE_CACHE_CONTROL;

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
  if (!accessKeyId || !secretAccessKey) throw new Error('Live2D HF read credentials are not configured.');
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

function createConcurrencyGate(limit: number): { acquire: () => Promise<() => void> } {
  let active = 0;
  const queue: Array<() => void> = [];
  return {
    async acquire() {
      if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
        queue.shift()?.();
      };
    },
  };
}

export interface Live2DAssetOriginReaderOptions {
  config: () => HfS3Config;
  fetch?: typeof fetch;
  attempts?: number;
  timeoutMs?: number;
  maxConcurrentReads?: number;
  retryDelay?: (attempt: number) => Promise<void>;
}

export interface Live2DAssetOriginReader {
  read(asset: Live2DAssetDescriptor): Promise<Response>;
  readonly inFlightCount: number;
}

/**
 * 同一不可变 key 的并发冷读共用一个 HF 请求，再为各响应 tee 出独立流。
 * origin 请求不绑定任一访客的 AbortSignal，避免其中一个客户端断开导致其余请求一起失败。
 */
export function createLive2DAssetOriginReader(options: Live2DAssetOriginReaderOptions): Live2DAssetOriginReader {
  const fetchImpl = options.fetch ?? fetch;
  const attempts = options.attempts ?? DEFAULT_ORIGIN_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_ORIGIN_TIMEOUT_MS;
  const retryDelay = options.retryDelay ?? ((attempt) => new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt)));
  const gate = createConcurrencyGate(options.maxConcurrentReads ?? DEFAULT_MAX_CONCURRENT_READS);
  const inFlight = new Map<string, Promise<Response>>();

  async function readFromOrigin(asset: Live2DAssetDescriptor): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const releasePermit = await gate.acquire();
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
          signal: controller.signal,
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
        const retryable = error instanceof Live2DOriginError ? error.retryable : isTransientFetchError(error);
        if (!retryable || attempt + 1 >= attempts) break;
        await retryDelay(attempt);
      }
    }
    if (lastError instanceof Live2DOriginError) throw lastError;
    throw new Live2DOriginError('Live2D origin request failed.', false, 502);
  }

  return {
    async read(asset) {
      let shared = inFlight.get(asset.key);
      if (!shared) {
        shared = readFromOrigin(asset);
        inFlight.set(asset.key, shared);
        void shared.then(
          (response) => {
            // 等待同一轮 Promise reaction 都 clone 完成后，取消无人消费的原始分支。
            setTimeout(() => {
              inFlight.delete(asset.key);
              void response.body?.cancel().catch(() => undefined);
            }, COLD_READ_COALESCE_WINDOW_MS);
          },
          () => inFlight.delete(asset.key),
        );
      }
      return (await shared).clone();
    },
    get inFlightCount() {
      return inFlight.size;
    },
  };
}
