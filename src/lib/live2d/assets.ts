import anonManifestData from '../../data/live2d/manifests/9e95d66201f07e339bd5542b1dd0d67ae1bd0b0f9b14a7335ca0bad6bd5916ad.json';
import { createHfS3PresignedUrl, type HfS3Config } from '../hf-s3';
import { live2dCatalog } from './catalog';
import { type Live2DManifestObject, type Live2DPackageManifest, live2dPackageManifestSchema } from './types';

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const DEFAULT_ORIGIN_ATTEMPTS = 3;
const DEFAULT_ORIGIN_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_CONCURRENT_READS = 6;
const COLD_READ_COALESCE_WINDOW_MS = 100;

/** Vercel 对流式 Function 响应的当前上限为 20 MB；保持常量而非允许环境变量放大。 */
export const LIVE2D_MAX_ASSET_BYTES = 20_000_000;
export const LIVE2D_BROWSER_CACHE_CONTROL = IMMUTABLE_CACHE_CONTROL;
export const LIVE2D_CDN_CACHE_CONTROL = IMMUTABLE_CACHE_CONTROL;

const packageManifests = [live2dPackageManifestSchema.parse(anonManifestData)] as const;
const manifestByRelease = new Map<string, Live2DPackageManifest>(
  packageManifests.map((manifest) => [manifest.releaseId, manifest]),
);

for (const character of live2dCatalog.characters) {
  for (const costume of character.costumes) {
    if (!manifestByRelease.has(costume.releaseId)) {
      throw new Error(`Live2D catalog release has no checked-in manifest: ${costume.releaseId}`);
    }
  }
}

export type Live2DAssetPathErrorCode = 'invalid-path' | 'unknown-release' | 'not-in-manifest' | 'object-too-large';

export class Live2DAssetPathError extends Error {
  constructor(
    readonly code: Live2DAssetPathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'Live2DAssetPathError';
  }
}

export interface Live2DAssetDescriptor extends Live2DManifestObject {
  key: string;
  releaseId: string;
}

function decodePathOnce(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Live2DAssetPathError('invalid-path', 'Live2D asset path contains invalid percent encoding.');
  }
}

function assertSafeSegments(value: string): string[] {
  if (!value || value.includes('\\') || value.includes('\0') || value.includes('?') || value.includes('#')) {
    throw new Live2DAssetPathError('invalid-path', 'Live2D asset path contains a forbidden separator.');
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Live2DAssetPathError('invalid-path', 'Live2D asset path contains an empty or traversal segment.');
  }
  return segments;
}

/**
 * 对路由 key 只解码一次并拒绝任何可改变目录层级的写法。
 * 返回值始终采用 `releases/<sha256>/<manifest path>` 的唯一形式。
 */
export function normalizeLive2DAssetKey(value: string): string {
  const decoded = decodePathOnce(value);
  if (decoded.startsWith('/') || decoded.endsWith('/')) {
    throw new Live2DAssetPathError('invalid-path', 'Live2D asset path must be relative.');
  }
  const segments = assertSafeSegments(decoded);
  if (segments[0] !== 'releases' || !/^[a-f0-9]{64}$/.test(segments[1] ?? '') || segments.length < 3) {
    throw new Live2DAssetPathError('invalid-path', 'Live2D asset path does not use the immutable release layout.');
  }
  return segments.join('/');
}

function normalizeRelativeManifestPath(value: string): string {
  const decoded = decodePathOnce(value).replace(/^\.\//, '');
  if (decoded.startsWith('/') || decoded.endsWith('/')) {
    throw new Live2DAssetPathError('invalid-path', 'Live2D package path must be relative.');
  }
  return assertSafeSegments(decoded).join('/');
}

export function getLive2DPackageManifest(releaseId: string): Live2DPackageManifest | null {
  return manifestByRelease.get(releaseId) ?? null;
}

/** Resolves only exact members of a catalog-backed, checked-in immutable manifest. */
export function resolveLive2DAsset(value: string): Live2DAssetDescriptor {
  const key = normalizeLive2DAssetKey(value);
  const [, releaseId, ...relativeSegments] = key.split('/');
  const manifest = manifestByRelease.get(releaseId);
  if (!manifest) throw new Live2DAssetPathError('unknown-release', 'Unknown Live2D release.');
  const relativePath = relativeSegments.join('/');
  const object = manifest.objects.find((candidate) => candidate.path === relativePath);
  if (!object) throw new Live2DAssetPathError('not-in-manifest', 'Live2D asset is not present in the release manifest.');
  if (object.size > LIVE2D_MAX_ASSET_BYTES) {
    throw new Live2DAssetPathError('object-too-large', 'Live2D asset exceeds the streaming response limit.');
  }
  return { ...object, key, releaseId };
}

export function resolveLive2DPackageAsset(releaseId: string, relativePath: string): Live2DAssetDescriptor {
  return resolveLive2DAsset(`releases/${releaseId}/${normalizeRelativeManifestPath(relativePath)}`);
}

function encodeAssetKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
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
          redirect: 'error',
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
        if (contentType !== asset.mime.toLowerCase()) {
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

export type Live2DDirectFailureReason = 'cors' | 'redirect' | 'network' | 'timeout' | 'http' | 'mime' | 'referrer-policy';

export class Live2DAssetDeliveryError extends Error {
  constructor(
    readonly reason: Live2DDirectFailureReason | 'aborted' | 'integrity' | 'fallback',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'Live2DAssetDeliveryError';
  }
}

export class Live2DAssetSessionCircuitBreaker {
  private failure: Live2DDirectFailureReason | null = null;

  get isOpen(): boolean {
    return this.failure !== null;
  }

  get reason(): Live2DDirectFailureReason | null {
    return this.failure;
  }

  open(reason: Live2DDirectFailureReason): void {
    this.failure ??= reason;
  }
}

export const live2DAssetSessionCircuitBreaker = new Live2DAssetSessionCircuitBreaker();

function classifyFetchFailure(error: unknown, signal: AbortSignal): Live2DAssetDeliveryError {
  if (signal.aborted) return new Live2DAssetDeliveryError('aborted', 'Live2D asset request was aborted.', { cause: error });
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new Live2DAssetDeliveryError('timeout', 'Live2D direct request timed out.', { cause: error });
  }
  return new Live2DAssetDeliveryError('network', 'Live2D direct request failed.', { cause: error });
}

function assertResponseMetadata(response: Response, asset: Live2DAssetDescriptor, direct: boolean): void {
  if (direct && response.type === 'opaque') throw new Live2DAssetDeliveryError('cors', 'Live2D direct response is opaque.');
  if (direct && response.redirected) throw new Live2DAssetDeliveryError('redirect', 'Live2D direct response redirected.');
  if (!response.ok) {
    throw new Live2DAssetDeliveryError(direct ? 'http' : 'fallback', `Live2D asset request returned ${response.status}.`);
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== asset.mime.toLowerCase()) {
    throw new Live2DAssetDeliveryError(direct ? 'mime' : 'fallback', 'Live2D asset MIME type is invalid.');
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number.parseInt(contentLength, 10) !== asset.size) {
    throw new Live2DAssetDeliveryError('integrity', 'Live2D asset size does not match the immutable manifest.');
  }
}

async function validateResponseMetadata(response: Response, asset: Live2DAssetDescriptor, direct: boolean): Promise<void> {
  try {
    assertResponseMetadata(response, asset, direct);
  } catch (error) {
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }
}

function assetUrl(base: URL, key: string): URL {
  const normalizedBase = new URL(base);
  normalizedBase.pathname = `${normalizedBase.pathname.replace(/\/+$/, '')}/${encodeAssetKey(key)}`;
  normalizedBase.search = '';
  normalizedBase.hash = '';
  return normalizedBase;
}

function assetFromResourcePath(
  releaseId: string,
  request: { path: string; url: URL },
  directBaseUrl: URL,
  fallbackBaseUrl: URL,
): Live2DAssetDescriptor {
  for (const base of [directBaseUrl, fallbackBaseUrl]) {
    const prefix = `${base.pathname.replace(/\/+$/, '')}/`;
    if (request.url.origin === base.origin && request.url.pathname.startsWith(prefix)) {
      return resolveLive2DAsset(request.url.pathname.slice(prefix.length));
    }
  }
  if (request.path.startsWith('releases/')) return resolveLive2DAsset(request.path);
  if (/^[a-z][a-z\d+.-]*:/i.test(request.path) || request.path.startsWith('//')) {
    throw new Live2DAssetPathError('invalid-path', 'External Live2D dependency URL is forbidden.');
  }
  return resolveLive2DPackageAsset(releaseId, request.path);
}

export interface Live2DResourceRequest {
  path: string;
  url: URL;
  signal: AbortSignal;
  referrerPolicy: 'no-referrer';
}

export interface CreateLive2DAssetRequestHookOptions {
  releaseId: string;
  directBaseUrl: URL;
  fallbackBaseUrl: URL;
  fetch?: typeof fetch;
  directEnabled?: boolean;
  referrerPolicySupported?: boolean;
  directTimeoutMs?: number;
  circuitBreaker?: Live2DAssetSessionCircuitBreaker;
}

/** Creates the sole browser resource-I/O boundary consumed by the patched renderer. */
export function createLive2DAssetRequestHook(options: CreateLive2DAssetRequestHookOptions) {
  const fetchImpl = options.fetch ?? fetch;
  const circuit = options.circuitBreaker ?? live2DAssetSessionCircuitBreaker;
  const directTimeoutMs = options.directTimeoutMs ?? 10_000;

  return async (request: Live2DResourceRequest): Promise<Response> => {
    const asset = assetFromResourcePath(options.releaseId, request, options.directBaseUrl, options.fallbackBaseUrl);
    if (asset.releaseId !== options.releaseId) {
      throw new Live2DAssetPathError('unknown-release', 'Live2D dependency escaped the selected release.');
    }
    if (request.signal.aborted) throw new Live2DAssetDeliveryError('aborted', 'Live2D asset request was aborted.');

    const fetchFallback = async (): Promise<Response> => {
      try {
        const response = await fetchImpl(assetUrl(options.fallbackBaseUrl, asset.key), {
          cache: 'force-cache',
          referrerPolicy: 'no-referrer',
          signal: request.signal,
        });
        await validateResponseMetadata(response, asset, false);
        return response;
      } catch (error) {
        if (error instanceof Live2DAssetDeliveryError) throw error;
        if (request.signal.aborted) {
          throw new Live2DAssetDeliveryError('aborted', 'Live2D fallback request was aborted.', { cause: error });
        }
        throw new Live2DAssetDeliveryError('fallback', 'Live2D fallback request failed.', { cause: error });
      }
    };

    if (options.directEnabled === false || circuit.isOpen) return fetchFallback();
    if (options.referrerPolicySupported === false) {
      circuit.open('referrer-policy');
      return fetchFallback();
    }

    const timeoutSignal = AbortSignal.timeout(directTimeoutMs);
    const signal = AbortSignal.any([request.signal, timeoutSignal]);
    try {
      const response = await fetchImpl(assetUrl(options.directBaseUrl, asset.key), {
        cache: 'force-cache',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        signal,
      });
      await validateResponseMetadata(response, asset, true);
      return response;
    } catch (error) {
      const failure = error instanceof Live2DAssetDeliveryError ? error : classifyFetchFailure(error, request.signal);
      if (failure.reason === 'aborted' || failure.reason === 'integrity' || failure.reason === 'fallback') throw failure;
      circuit.open(failure.reason);
      return fetchFallback();
    }
  };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface Live2DDirectCanaryOptions {
  releaseId: string;
  directBaseUrl: URL;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  referrerPolicySupported?: boolean;
  circuitBreaker?: Live2DAssetSessionCircuitBreaker;
}

/**
 * Direct 模式只有在完整 manifest 依赖图的 CORS、MIME、长度和摘要全部通过后才启用。
 * 完整校验失败不会泄露 URL；完整性失败也不会被同源 fallback 掩盖。
 */
export async function runLive2DDirectCanary(
  options: Live2DDirectCanaryOptions,
): Promise<{ mode: 'direct' } | { mode: 'fallback'; reason: Live2DDirectFailureReason }> {
  const manifest = manifestByRelease.get(options.releaseId);
  if (!manifest) throw new Live2DAssetPathError('unknown-release', 'Unknown Live2D release.');
  const circuit = options.circuitBreaker ?? live2DAssetSessionCircuitBreaker;
  if (circuit.isOpen) return { mode: 'fallback', reason: circuit.reason ?? 'network' };
  if (options.referrerPolicySupported === false) {
    circuit.open('referrer-policy');
    return { mode: 'fallback', reason: 'referrer-policy' };
  }
  const fetchImpl = options.fetch ?? fetch;
  for (const object of manifest.objects) {
    const asset = resolveLive2DPackageAsset(options.releaseId, object.path);
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      const response = await fetchImpl(assetUrl(options.directBaseUrl, asset.key), {
        cache: 'force-cache',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        signal,
      });
      await validateResponseMetadata(response, asset, true);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== asset.size || (await sha256Hex(bytes)) !== asset.sha256) {
        throw new Live2DAssetDeliveryError('integrity', 'Live2D direct canary digest mismatch.');
      }
    } catch (error) {
      const failure =
        error instanceof Live2DAssetDeliveryError
          ? error
          : classifyFetchFailure(error, options.signal ?? new AbortController().signal);
      if (failure.reason === 'integrity' || failure.reason === 'aborted') throw failure;
      circuit.open(failure.reason as Live2DDirectFailureReason);
      return { mode: 'fallback', reason: failure.reason as Live2DDirectFailureReason };
    }
  }
  return { mode: 'direct' };
}
