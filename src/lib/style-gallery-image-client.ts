import { parseStyleGalleryImageApiPath, STYLE_GALLERY_IMAGE_SIGN_BATCH_SIZE } from './style-gallery-image-key';

const BATCH_SIGN_TIMEOUT_MS = 15_000;
const BATCH_SIGN_ATTEMPTS = 3;
const BATCH_SIGN_RETRY_BASE_MS = 200;
const LEGACY_RESPONSE_CACHE_MS = 5 * 60 * 1000;
const RETAINED_PRELOAD_LIMIT = 48;
const RETAINED_PRELOAD_PIXEL_BUDGET = 64 * 1024 * 1024;
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
const loadedUrlBySource = new Map<string, string>();
const sourceListeners = new Map<string, Set<(url: string) => void>>();
const retainedPreloads = new Map<string, { image: HTMLImageElement; pixels: number }>();
let activePreloads = new Map<string, Promise<boolean>>();
let retainedPreloadPixels = 0;
let preloadGeneration = 0;
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
  if (loadedUrlBySource.get(source) === cached.url) loadedUrlBySource.delete(source);
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
  const loadedUrl = loadedUrlBySource.get(source);
  if (loadedUrl && (loadedUrl === source || loadedUrl === cachedUrl) && loadedImageUrls.has(loadedUrl)) return loadedUrl;
  // 已显示的 URL 优先于“只完成预签名、尚未下载”的直连地址，否则打开 Lightbox 会切换缓存键并重新等待。
  if (cachedUrl && loadedImageUrls.has(cachedUrl)) return cachedUrl;
  if (sourceLoaded || loadedImageUrls.has(source)) return source;
  return cachedUrl;
}

/** Lightbox 用它同步判断新建 img 是否可以直接复用当前页面已经解码的图片。 */
export function isStyleGalleryImageUrlLoaded(source: string): boolean {
  return loadedImageUrls.has(source);
}

/**
 * 判断新挂载的 img 是否可以立即显示。共享缓存中的 loaded 状态优先于新 DOM 节点短暂的
 * `complete === false`：同一资源从卡片切到 Lightbox 或在 Lightbox 中往返时，新节点尚未完成
 * 初始化不代表图片资源失效，不能因此重新显示 loading。
 */
export function isStyleGalleryImageRenderable(
  source: string,
  image: Pick<HTMLImageElement, 'complete' | 'naturalWidth'> | null = null,
): boolean {
  return loadedImageUrls.has(source) || Boolean(image?.complete && image.naturalWidth > 0);
}

/** 记录 Lightbox 自己加载完成的签名地址，保证键盘返回或关闭后重开时不再显示虚假的 loading。 */
export function markStyleGalleryImageUrlLoaded(url: string, source = url): void {
  loadedImageUrls.add(url);
  const current = loadedUrlBySource.get(source);
  const cachedUrl = getCachedStyleGalleryImageUrl(source);
  // 已完成的签名直连优先于 canonical 302；后到的卡片 load 事件不能把共享地址切回重定向路径。
  if (!current || url === cachedUrl || !loadedImageUrls.has(current)) {
    loadedUrlBySource.set(source, url);
    if (current !== url) {
      sourceListeners.get(source)?.forEach((listener) => {
        listener(url);
      });
    }
  }
}

/**
 * 记录页面中已经解码完成的高清图。Astro SSR 输出的 img 可能早于 React island hydration 加载完成，
 * 因此调用方必须同时在 callback ref 和 onLoad 中调用本函数，不能只监听 onLoad。
 */
export function rememberLoadedStyleGalleryImage(
  loadedSources: Set<string>,
  source: string,
  image: Pick<HTMLImageElement, 'complete' | 'naturalWidth'> | null,
  renderedUrl = source,
): void {
  if (image?.complete && image.naturalWidth > 0) {
    loadedSources.add(source);
    markStyleGalleryImageUrlLoaded(renderedUrl, source);
  }
}

/**
 * 订阅某个 canonical 图片实际完成加载后的共享地址。只有对应卡片会更新，不会为了后台预加载
 * 重渲染整个瀑布流；订阅者若已经显示可用图片，可以自行忽略通知以避免无意义的 src 切换。
 */
export function subscribeStyleGalleryImageSource(source: string, listener: (url: string) => void): () => void {
  let listeners = sourceListeners.get(source);
  if (!listeners) {
    listeners = new Set();
    sourceListeners.set(source, listeners);
  }
  listeners.add(listener);
  const loadedUrl = getReusableStyleGalleryImageUrl(source, false);
  if (loadedUrl && loadedImageUrls.has(loadedUrl)) listener(loadedUrl);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) sourceListeners.delete(source);
  };
}

export interface StyleGalleryImagePreload {
  /** 稳定的同源 API 地址，用于让卡片、Lightbox 和签名缓存关联到同一张图片。 */
  source: string;
  /** 本轮实际下载的签名直连地址。 */
  url: string;
  /** 当前导航附近使用高优先级，其余保持自动调度，避免大批预载抢占当前图片。 */
  priority?: 'high' | 'auto';
}

function retainPreload(url: string, image: HTMLImageElement): void {
  const previous = retainedPreloads.get(url);
  if (previous) retainedPreloadPixels -= previous.pixels;
  retainedPreloads.delete(url);
  const pixels = Math.max(1, image.naturalWidth || 1) * Math.max(1, image.naturalHeight || 1);
  // 单张异常大图也不能突破预算；它仍可留在浏览器 HTTP 缓存，但不保留强引用占用解码内存。
  if (pixels > RETAINED_PRELOAD_PIXEL_BUDGET) return;
  retainedPreloads.set(url, { image, pixels });
  retainedPreloadPixels += pixels;
  while (retainedPreloads.size > RETAINED_PRELOAD_LIMIT || retainedPreloadPixels > RETAINED_PRELOAD_PIXEL_BUDGET) {
    const oldest = retainedPreloads.keys().next().value;
    if (typeof oldest !== 'string') break;
    retainedPreloadPixels -= retainedPreloads.get(oldest)?.pixels ?? 0;
    retainedPreloads.delete(oldest);
  }
}

/**
 * 并发预下载并解码已签名图片，再把完成状态回写到全局图片注册表。热缓存同时受数量与约
 * 64M 像素预算约束；更早的图片仍使用 HTTP 缓存，避免高清图库无限占用解码内存。
 */
export async function preloadStyleGalleryImages(images: readonly StyleGalleryImagePreload[]): Promise<void> {
  if (typeof Image === 'undefined') return;
  const generation = preloadGeneration;
  const generationJobs = activePreloads;
  const jobs = images.map(({ source, url, priority }) => {
    if (loadedImageUrls.has(url)) {
      markStyleGalleryImageUrlLoaded(url, source);
      return Promise.resolve(true);
    }
    let job = generationJobs.get(url);
    if (!job) {
      job = new Promise<boolean>((resolve) => {
        const image = new Image();
        image.decoding = 'async';
        image.fetchPriority = priority ?? 'auto';
        image.onload = () => {
          image.onload = null;
          image.onerror = null;
          void image
            .decode()
            .catch(() => undefined)
            .then(() => {
              if (image.naturalWidth <= 0) {
                resolve(false);
                return;
              }
              if (generation !== preloadGeneration) {
                resolve(false);
                return;
              }
              retainPreload(url, image);
              markStyleGalleryImageUrlLoaded(url, source);
              resolve(true);
            });
        };
        image.onerror = () => {
          image.onload = null;
          image.onerror = null;
          resolve(false);
        };
        image.src = url;
      }).finally(() => {
        // reset 会替换整张任务表；旧任务只能清理自己所属代际，不能删掉同 URL 的新任务。
        if (generation === preloadGeneration && activePreloads === generationJobs && generationJobs.get(url) === job) {
          generationJobs.delete(url);
        }
      });
      generationJobs.set(url, job);
    }
    return job.then((loaded) => {
      if (loaded && generation === preloadGeneration) markStyleGalleryImageUrlLoaded(url, source);
      return loaded;
    });
  });
  await Promise.allSettled(jobs);
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
  const loadedUrl = loadedUrlBySource.get(source);
  if (loadedUrl && loadedUrl !== source) loadedUrlBySource.delete(source);
}

/** 测试与 Astro 页面切换时可显式释放会话级缓存。 */
export function resetStyleGalleryImageUrlCache(): void {
  preloadGeneration += 1;
  signedUrlCache.clear();
  loadedImageUrls.clear();
  loadedUrlBySource.clear();
  sourceListeners.clear();
  retainedPreloads.clear();
  retainedPreloadPixels = 0;
  activePreloads = new Map();
  activeRequests = new Map();
}
