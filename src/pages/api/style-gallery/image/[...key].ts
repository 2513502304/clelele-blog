import { createStyleGallerySignedImageUrl } from '@lib/hf-s3-presign';
import type { APIRoute } from 'astro';

export const prerender = false;

function isAllowedImageKey(key: string): boolean {
  if (key.includes('..') || key.includes('\\')) return false;
  if (/^\/?(source|thumb)\/[a-f0-9]{12}\.(jpg|jpeg|png|webp)$/i.test(key)) return true;
  return /^\/?examples\/images\/[a-f0-9]{64}\.(jpg|jpeg|png|webp)$/i.test(key);
}

const DEVELOPMENT_IMAGE_TIMEOUT_MS = 30_000;

/**
 * Astro 开发审计会主动 fetch 图片，无法跨越不带 CORS 响应头的 HF 重定向。
 * 因此仅在开发环境同源代理图片；生产环境继续使用省带宽的签名 URL 重定向。
 */
async function proxyDevelopmentImage(signedUrl: string): Promise<Response> {
  const upstream = await fetch(signedUrl, {
    cache: 'no-store',
    signal: AbortSignal.timeout(DEVELOPMENT_IMAGE_TIMEOUT_MS),
  });
  if (!upstream.ok) {
    return new Response(`Failed to load style gallery image: ${upstream.status}`, { status: upstream.status });
  }

  const headers = new Headers({ 'cache-control': 'private, max-age=300' });
  for (const name of ['content-length', 'content-type', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: 200, headers });
}

export const GET: APIRoute = async ({ params }) => {
  const key = params.key;
  if (!key || !isAllowedImageKey(key)) {
    return new Response('Invalid style gallery image key.', { status: 400 });
  }

  try {
    const signedUrl = createStyleGallerySignedImageUrl(key);
    if (import.meta.env.DEV) return await proxyDevelopmentImage(signedUrl);

    return new Response(null, {
      status: 302,
      headers: {
        location: signedUrl,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Failed to sign image URL.', { status: 500 });
  }
};
