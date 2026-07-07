import { createStyleGallerySignedImageUrl } from '@lib/hf-s3-presign';
import type { APIRoute } from 'astro';

export const prerender = false;

function isAllowedImageKey(key: string): boolean {
  if (key.includes('..') || key.includes('\\')) return false;
  if (/^\/?(source|thumb)\/[a-f0-9]{12}\.(jpg|jpeg|png|webp)$/i.test(key)) return true;
  return /^\/?examples\/[a-z0-9-]+\/[a-z0-9-]+\/[a-f0-9]{12}\.(jpg|jpeg|png|webp)$/i.test(key);
}

export const GET: APIRoute = ({ params }) => {
  const key = params.key;
  if (!key || !isAllowedImageKey(key)) {
    return new Response('Invalid style gallery image key.', { status: 400 });
  }

  try {
    return new Response(null, {
      status: 302,
      headers: {
        location: createStyleGallerySignedImageUrl(key),
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Failed to sign image URL.', { status: 500 });
  }
};
