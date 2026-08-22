import { createStyleGallerySignedImageUrl, getStyleGallerySignedImageRedirectCacheSeconds } from '@lib/hf-s3-presign';
import { isAllowedStyleGalleryImageKey } from '@lib/style-gallery-image-key';
import type { APIRoute } from 'astro';

export const prerender = false;

const IMAGE_TRANSFER_TIMEOUT_MS = 60_000;

/**
 * Astro 开发审计无法跨越 HF 的无 CORS 重定向，因此开发环境同源代理图片。
 * HF Bucket 会忽略签名 URL 的 Content-Disposition 覆盖参数；下载请求也必须流式代理并强制 attachment。
 */
async function proxyImage(signedUrl: string, downloadFilename?: string): Promise<Response> {
  const controller = new AbortController();
  const connectionTimeout = setTimeout(() => controller.abort(), IMAGE_TRANSFER_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(signedUrl, {
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    // fetch() 返回后响应体仍在流式读取；此后继续计时会截断合法的慢速大文件下载。
    clearTimeout(connectionTimeout);
  }
  if (!upstream.ok) {
    return new Response(`Failed to load style gallery image: ${upstream.status}`, { status: upstream.status });
  }

  const headers = new Headers({ 'cache-control': 'private, max-age=300' });
  for (const name of ['content-length', 'content-type', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (downloadFilename) headers.set('content-disposition', `attachment; filename="${downloadFilename}"`);
  return new Response(upstream.body, { status: 200, headers });
}

export const GET: APIRoute = async ({ params, request }) => {
  const key = params.key;
  if (!key || !isAllowedStyleGalleryImageKey(key)) {
    return new Response('Invalid style gallery image key.', { status: 400 });
  }

  try {
    const download = new URL(request.url).searchParams.get('download') === '1';
    const signedUrl = createStyleGallerySignedImageUrl(key);
    const filename =
      key
        .split('/')
        .at(-1)
        ?.replace(/[^a-zA-Z0-9._-]/g, '_') || 'image';
    if (download || import.meta.env.DEV) return await proxyImage(signedUrl, download ? filename : undefined);

    const cacheSeconds = getStyleGallerySignedImageRedirectCacheSeconds();
    return new Response(null, {
      status: 302,
      headers: {
        location: signedUrl,
        // 浏览器和 Vercel 边缘节点都可复用 302；缓存会在签名失效前提前结束，随后自然换取新 URL。
        'cache-control': cacheSeconds ? `public, max-age=${cacheSeconds}` : 'no-store',
        ...(cacheSeconds && { 'vercel-cdn-cache-control': `public, s-maxage=${cacheSeconds}` }),
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Failed to sign image URL.', { status: 500 });
  }
};
