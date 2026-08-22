import { parseStyleGalleryImageApiPath } from './style-gallery-image-key';

const BATCH_SIGN_TIMEOUT_MS = 15_000;
const BATCH_SIGN_ATTEMPTS = 3;
const BATCH_SIGN_RETRY_BASE_MS = 200;
const signedUrlCache = new Map<string, string>();
let activeRequests = new Map<string, Promise<Record<string, string>>>();

function isRetryableSigningError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)) return true;
  return error instanceof Error && /HTTP (?:408|429|5\d\d)\b/.test(error.message);
}

async function requestSignedUrls(keys: readonly string[]): Promise<Record<string, string>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= BATCH_SIGN_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch('/api/style-gallery/images', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys }),
        signal: AbortSignal.timeout(BATCH_SIGN_TIMEOUT_MS),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Image signing failed with HTTP ${response.status}${detail ? `: ${detail}` : '.'}`);
      }
      const body = (await response.json()) as { images?: Record<string, string> };
      return body.images ?? {};
    } catch (error) {
      if (!isRetryableSigningError(error)) throw error;
      lastError = error;
      if (attempt < BATCH_SIGN_ATTEMPTS) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, BATCH_SIGN_RETRY_BASE_MS * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Image signing failed after retries.');
}

/**
 * 将同一导航窗口内尚未签名的图片合并成一次请求。缓存以稳定同源 URL 为 key，
 * 页面生命周期内重复打开 lightbox 不会再次签名；签名本身仍受服务端 TTL 限制。
 */
export async function resolveStyleGalleryImageUrls(sources: readonly string[]): Promise<Record<string, string>> {
  const uniqueSources = [...new Set(sources)];
  const result: Record<string, string> = {};
  const missing: Array<{ source: string; key: string }> = [];
  for (const source of uniqueSources) {
    const cached = signedUrlCache.get(source);
    if (cached) {
      result[source] = cached;
      continue;
    }
    const key = parseStyleGalleryImageApiPath(source);
    if (key) missing.push({ source, key });
  }
  if (missing.length === 0) return result;

  const requestKey = missing
    .map(({ key }) => key)
    .sort()
    .join('\n');
  let request = activeRequests.get(requestKey);
  if (!request) {
    request = requestSignedUrls(missing.map(({ key }) => key)).finally(() => activeRequests.delete(requestKey));
    activeRequests.set(requestKey, request);
  }

  const resolved = await request;
  for (const [source, url] of Object.entries(resolved)) {
    if (!parseStyleGalleryImageApiPath(source) || typeof url !== 'string' || !url) continue;
    signedUrlCache.set(source, url);
    result[source] = url;
  }
  return result;
}

/** 测试与 Astro 页面切换时可显式释放会话级缓存。 */
export function resetStyleGalleryImageUrlCache(): void {
  signedUrlCache.clear();
  activeRequests = new Map();
}
