import type { APIRoute } from 'astro';
import { hpoiImageStorage } from '@/lib/hpoi/image-store';

export const prerender = false;
/** Only immutable Hpoi JPEGs are addressable; callers cannot read arbitrary HF keys. */
export const GET: APIRoute = async ({ url }) => {
  const key = url.searchParams.get('key') ?? '';
  if (!/^[a-f0-9]{64}\.jpg$/.test(key)) return new Response('Invalid image key', { status: 400 });
  try {
    const image = await hpoiImageStorage().get(`objects/${key}`);
    if (!image) return new Response('Image not found', { status: 404 });
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        'content-type': 'image/jpeg',
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return new Response('Image temporarily unavailable', { status: 502 });
  }
};
