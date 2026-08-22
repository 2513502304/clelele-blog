import { parseStyleGalleryImageApiPath, STYLE_GALLERY_IMAGE_SIGN_BATCH_SIZE } from './style-gallery-image-key';

const BATCH_SIGN_TIMEOUT_MS = 15_000;
const BATCH_SIGN_ATTEMPTS = 3;
const BATCH_SIGN_RETRY_BASE_MS = 200;
const LEGACY_RESPONSE_CACHE_MS = 5 * 60 * 1000;
interface SignedUrlResponse {
  images: Record<string, string>;
  expiresAt: number | null;
}

interface SignedUrlCacheEntry {
  url: string;
  expiresAt: number | null;
}

const signedUrlCache = new Map<string, SignedUrlCacheEntry>();
const loadedImageUrls = new Set<string>();
let activeRequests = new Map<string, Promise<SignedUrlResponse>>();

/**
 * 同步读取仍有效的签名地址，供重新打开 Lightbox 时直接复用上一轮结果。
 * 这里不触发网络请求；过期项会立即清理，调用方随后仍可进入正常批量签名流程。
 */
export function getCachedStyleGalleryImageUrl(source: string): string | undefined {
  const cached = signedUrlCache.get(source);
  if (!cached) return undefined;
  if (cached.expiresAt === null || cached.expiresAt > Date.now()) return cached.url;
  signedUrlCache.delete(source);
  return undefined;
}

/**
 * Lightbox 图片地址复用的唯一决策入口：
 * 1. 会话内仍有效的 HF 签名 URL 优先，避免关闭后重开又先请求 canonical 302；
 * 2. 页面已经确认加载完成的高清 canonical URL 可以直接复用浏览器缓存；
 * 3. 未加载过的 canonical URL不得伪装成 resolved，否则会跳过后续图片的批量签名与预加载。
 *
 * `sourceLoaded` 必须来自真实 img onLoad，而不是“元素已经挂载”的推断。
 */
export function getReusableStyleGalleryImageUrl(source: string, sourceLoaded: boolean): string | undefined {
  const cachedUrl = getCachedStyleGalleryImageUrl(source);
  // 已显示的 URL 优先于“只完成预签名、尚未下载”的直连地址，否则打开 Lightbox 会切换缓存键并重新等待。
  if (cachedUrl && loadedImageUrls.has(cachedUrl)) return cachedUrl;
  if (sourceLoaded || loadedImageUrls.has(source)) return source;
  return cachedUrl;
}

/** Lightbox 用它同步判断新建 img 是否可以直接复用当前页面已经解码的图片。 */
export function isStyleGalleryImageUrlLoaded(source: string): boolean {
  return loadedImageUrls.has(source);
}

/** 记录 Lightbox 自己加载完成的签名地址，保证键盘返回或关闭后重开时不再显示虚假的 loading。 */
export function markStyleGalleryImageUrlLoaded(source: string): void {
  loadedImageUrls.add(source);
}

/**
 * 记录页面中已经解码完成的高清图。Astro SSR 输出的 img 可能早于 React island hydration 加载完成，
 * 因此调用方必须同时在 callback ref 和 onLoad 中调用本函数，不能只监听 onLoad。
 */
export function rememberLoadedStyleGalleryImage(
  loadedSources: Set<string>,
  source: string,
  image: Pick<HTMLImageElement, 'complete' | 'naturalWidth'> | null,
): void {
  if (image?.complete && image.naturalWidth > 0) {
    loadedSources.add(source);
    markStyleGalleryImageUrlLoaded(source);
  }
}

function isRetryableSigningError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)) return true;
  return error instanceof Error && /HTTP (?:408|429|5\d\d)\b/.test(error.message);
}

async function requestSignedUrls(keys: readonly string[]): Promise<SignedUrlResponse> {
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
      const body = (await response.json()) as { images?: Record<string, string>; expiresAt?: number | null };
      return {
        images: body.images ?? {},
        expiresAt:
          body.expiresAt === null
            ? null
            : typeof body.expiresAt === 'number' && Number.isFinite(body.expiresAt)
              ? body.expiresAt
              : Date.now() + LEGACY_RESPONSE_CACHE_MS,
      };
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
 * 在服务端给出的安全过期时间内复用；滚动部署期间的旧响应只短暂缓存，避免把未知 TTL 当成永久有效。
 */
export async function resolveStyleGalleryImageUrls(sources: readonly string[]): Promise<Record<string, string>> {
  const uniqueSources = [...new Set(sources)];
  const result: Record<string, string> = {};
  const missing: Array<{ source: string; key: string }> = [];
  for (const source of uniqueSources) {
    const cachedUrl = getCachedStyleGalleryImageUrl(source);
    if (cachedUrl) {
      result[source] = cachedUrl;
      continue;
    }
    const key = parseStyleGalleryImageApiPath(source);
    if (key) missing.push({ source, key });
  }
  if (missing.length === 0) return result;

  const requests: Promise<SignedUrlResponse>[] = [];
  for (let offset = 0; offset < missing.length; offset += STYLE_GALLERY_IMAGE_SIGN_BATCH_SIZE) {
    const batch = missing.slice(offset, offset + STYLE_GALLERY_IMAGE_SIGN_BATCH_SIZE);
    const requestKey = batch
      .map(({ key }) => key)
      .sort()
      .join('\n');
    let request = activeRequests.get(requestKey);
    if (!request) {
      request = requestSignedUrls(batch.map(({ key }) => key)).finally(() => activeRequests.delete(requestKey));
      activeRequests.set(requestKey, request);
    }
    requests.push(request);
  }

  for (const resolved of await Promise.all(requests)) {
    for (const [source, url] of Object.entries(resolved.images)) {
      if (!parseStyleGalleryImageApiPath(source) || typeof url !== 'string' || !url) continue;
      signedUrlCache.set(source, { url, expiresAt: resolved.expiresAt });
      result[source] = url;
    }
  }
  return result;
}

/** 图片服务器提前拒绝签名时只失效对应 URL，其他已加载图片仍可继续复用缓存。 */
export function invalidateStyleGalleryImageUrl(source: string): void {
  signedUrlCache.delete(source);
}

/** 测试与 Astro 页面切换时可显式释放会话级缓存。 */
export function resetStyleGalleryImageUrlCache(): void {
  signedUrlCache.clear();
  loadedImageUrls.clear();
  activeRequests = new Map();
}
