import { parseStyleGalleryImageApiPath } from './style-gallery-image-key';

const BATCH_SIGN_TIMEOUT_MS = 15_000;
const signedUrlCache = new Map<string, string>();
let activeRequests = new Map<string, Promise<Record<string, string>>>();

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
    request = fetch('/api/style-gallery/images', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys: missing.map(({ key }) => key) }),
      signal: AbortSignal.timeout(BATCH_SIGN_TIMEOUT_MS),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.text()) || `Image signing failed with ${response.status}`);
        const body = (await response.json()) as { images?: Record<string, string> };
        return body.images ?? {};
      })
      .finally(() => activeRequests.delete(requestKey));
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
