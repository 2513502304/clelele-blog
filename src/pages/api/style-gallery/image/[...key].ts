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
 * Astro's development audit fetches image URLs and cannot follow the HF redirect
 * because the bucket response has no CORS headers. Proxy only in development so
 * local audits stay same-origin; production keeps the bandwidth-efficient redirect.
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
