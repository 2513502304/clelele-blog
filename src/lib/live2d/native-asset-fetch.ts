/** Native packages share content-addressed files across costumes, but have different release URLs. */
const CACHE_NAME = 'live2d-native-assets-v1';
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 256;
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
type AssetCache = Pick<Cache, 'match' | 'put' | 'delete' | 'keys'>;
interface Options {
  fetch?: typeof fetch;
  openCache?: () => Promise<AssetCache>;
  maxBytes?: number;
  wait?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
}

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Retry only idempotent resource reads (including interrupted bodies), at most twice.
 * HTTP caching remains the fallback if persistent storage is unavailable or full.
 * The disk cache stores verified original bytes, never decoded models or GPU resources.
 */
export function createNativeAssetFetch(options: Options = {}): typeof fetch {
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const delay = options.wait ?? wait;
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  let cachePromise: Promise<AssetCache | undefined> | undefined;
  let writes = Promise.resolve();
  const openCache = () => {
    cachePromise ??= Promise.resolve()
      .then(options.openCache ?? (() => caches.open(CACHE_NAME)))
      .catch(() => undefined);
    return cachePromise;
  };
  let sizes: Map<string, number> | undefined;
  const save = (cache: AssetCache, key: string, response: Response, size: number) => {
    // Serialize insert + eviction. Index headers once rather than scanning the disk cache per file.
    writes = writes
      .then(async () => {
        if (size > maxBytes) return;
        if (!sizes) {
          sizes = new Map();
          for (const request of await cache.keys()) {
            sizes.set(request.url, Number((await cache.match(request))?.headers.get('Content-Length')) || 0);
          }
        }
        sizes.delete(key);
        let total = size + [...sizes.values()].reduce((a, b) => a + b, 0);
        for (const [oldKey, oldSize] of sizes) {
          if (total <= maxBytes && sizes.size < MAX_ENTRIES) break;
          await cache.delete(oldKey);
          sizes.delete(oldKey);
          total -= oldSize;
        }
        await cache.put(key, response);
        sizes.set(key, size);
      })
      .catch(() => {
        sizes = undefined;
      });
    return writes;
  };
  return async (input, init) => {
    if ((init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase() !== 'GET')
      return request(input, init);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    signal?.throwIfAborted();
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      typeof location === 'undefined' ? undefined : location.href,
    );
    const asset = /^\/api\/live2d-assets\/releases\/[a-f0-9]{64}\/assets\/([a-f0-9]{64})(\.[a-z0-9.]+)$/.exec(url.pathname);
    const compressed = asset && /\.(gz|br)$/.test(asset[2]);
    // Compressed names identify decoded content, but each manifest checks its exact stored size.
    // Preserve release identity there: equivalent content can have different compression bytes.
    const key =
      asset && !url.search && (typeof location === 'undefined' || url.origin === location.origin)
        ? compressed
          ? url.href
          : `${url.origin}/api/live2d-assets/.cache/${asset[1]}${asset[2]}`
        : null;
    const cache = key ? await openCache() : undefined;
    const hit = key && cache ? await cache.match(key).catch(() => undefined) : undefined;
    signal?.throwIfAborted();
    if (hit) return hit;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      let body: ArrayBuffer;
      try {
        response = await request(input, { ...init, cache: 'force-cache' });
        if (!response.ok) {
          if (!RETRY_STATUS.has(response.status) || attempt === 2) return response;
          await response.body?.cancel();
          await delay(350 * 2 ** attempt, signal);
          continue;
        }
        // Consume within the retry boundary: fetch resolves before a streaming body can fail.
        body = await response.arrayBuffer();
      } catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof TypeError) || attempt === 2) throw error;
        await delay(350 * 2 ** attempt, signal);
        continue;
      }
      signal?.throwIfAborted();
      // Native .gz filenames hash the decompressed content. Our asset route's strong ETag
      // hashes the served bytes instead, so no extra decompression is needed for validation.
      const expectedHash = asset
        ? (/^"sha256-([a-f0-9]{64})"$/.exec(response.headers.get('ETag') ?? '')?.[1] ?? (compressed ? undefined : asset[1]))
        : undefined;
      if (expectedHash) {
        const digest = await crypto.subtle.digest('SHA-256', body);
        const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
        if (hash !== expectedHash) throw new Error('Live2D resource integrity check failed.');
      }
      const headers = new Headers(response.headers);
      // Fetch has already decoded HTTP encoding. Preserve the actual cached body length.
      headers.delete('Content-Encoding');
      headers.set('Content-Length', String(body.byteLength));
      const result = new Response(body, { status: response.status, headers });
      if (key && cache && expectedHash) await save(cache, key, result.clone(), body.byteLength);
      signal?.throwIfAborted();
      return result;
    }
  };
}

export const fetchNativeAsset = createNativeAssetFetch();
