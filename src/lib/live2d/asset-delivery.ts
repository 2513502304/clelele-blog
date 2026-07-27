import {
  encodeLive2DAssetKey,
  getLive2DPackageManifest,
  type Live2DAssetDescriptor,
  Live2DAssetPathError,
  resolveLive2DAsset,
  resolveLive2DPackageAsset,
} from './asset-registry';

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
  normalizedBase.pathname = `${normalizedBase.pathname.replace(/\/+$/, '')}/${encodeLive2DAssetKey(key)}`;
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
  prefetchConcurrency?: number;
}

export interface Live2DAssetRequestHook {
  (request: Live2DResourceRequest): Promise<Response>;
  /** Warms only the selected immutable package and keeps its small byte set scoped to this hook. */
  prefetch(signal: AbortSignal): Promise<void>;
}

/** Creates the sole browser resource-I/O boundary consumed by the patched renderer. */
export function createLive2DAssetRequestHook(options: CreateLive2DAssetRequestHookOptions): Live2DAssetRequestHook {
  const fetchImpl = options.fetch ?? fetch;
  const circuit = options.circuitBreaker ?? live2DAssetSessionCircuitBreaker;
  const directTimeoutMs = options.directTimeoutMs ?? 10_000;
  const cachedBytes = new Map<string, Promise<Uint8Array>>();

  const fetchAsset = async (asset: Live2DAssetDescriptor, requestSignal: AbortSignal): Promise<Response> => {
    const fetchFallback = async (): Promise<Response> => {
      try {
        const response = await fetchImpl(assetUrl(options.fallbackBaseUrl, asset.key), {
          cache: 'force-cache',
          referrerPolicy: 'no-referrer',
          signal: requestSignal,
        });
        await validateResponseMetadata(response, asset, false);
        return response;
      } catch (error) {
        if (error instanceof Live2DAssetDeliveryError) throw error;
        if (requestSignal.aborted) {
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
    const signal = AbortSignal.any([requestSignal, timeoutSignal]);
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
      const failure = error instanceof Live2DAssetDeliveryError ? error : classifyFetchFailure(error, requestSignal);
      if (failure.reason === 'aborted' || failure.reason === 'integrity' || failure.reason === 'fallback') throw failure;
      circuit.open(failure.reason);
      return fetchFallback();
    }
  };

  const responseFromBytes = async (asset: Live2DAssetDescriptor, bytes: Promise<Uint8Array>): Promise<Response> => {
    const resolved = await bytes;
    return new Response(resolved.slice().buffer, {
      headers: {
        'content-length': String(asset.size),
        'content-type': asset.mime,
      },
    });
  };

  const hook = (async (request: Live2DResourceRequest): Promise<Response> => {
    const asset = assetFromResourcePath(options.releaseId, request, options.directBaseUrl, options.fallbackBaseUrl);
    if (asset.releaseId !== options.releaseId) {
      throw new Live2DAssetPathError('unknown-release', 'Live2D dependency escaped the selected release.');
    }
    if (request.signal.aborted) throw new Live2DAssetDeliveryError('aborted', 'Live2D asset request was aborted.');
    const cached = cachedBytes.get(asset.key);
    return cached ? responseFromBytes(asset, cached) : fetchAsset(asset, request.signal);
  }) as Live2DAssetRequestHook;

  hook.prefetch = async (signal: AbortSignal): Promise<void> => {
    const manifest = getLive2DPackageManifest(options.releaseId);
    if (!manifest) throw new Live2DAssetPathError('unknown-release', 'Unknown Live2D release.');
    const assets = manifest.objects.map((object) => resolveLive2DPackageAsset(options.releaseId, object.path));
    let cursor = 0;
    const warm = async (asset: Live2DAssetDescriptor): Promise<void> => {
      if (cachedBytes.has(asset.key)) {
        await cachedBytes.get(asset.key);
        return;
      }
      const pending = (async () => {
        const response = await fetchAsset(asset, signal);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== asset.size) {
          throw new Live2DAssetDeliveryError('integrity', 'Live2D prefetched asset size does not match its manifest.');
        }
        return new Uint8Array(buffer);
      })();
      cachedBytes.set(asset.key, pending);
      try {
        await pending;
      } catch (error) {
        cachedBytes.delete(asset.key);
        throw error;
      }
    };
    const worker = async () => {
      while (cursor < assets.length) {
        signal.throwIfAborted();
        const asset = assets[cursor];
        cursor += 1;
        if (asset) await warm(asset);
      }
    };
    const concurrency = Math.max(1, Math.min(options.prefetchConcurrency ?? 6, assets.length));
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  };

  return hook;
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
  const manifest = getLive2DPackageManifest(options.releaseId);
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
