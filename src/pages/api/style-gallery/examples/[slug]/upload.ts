import { isAuthorizedStyleGalleryRequest } from '@lib/style-gallery-auth';
import { handleStyleGalleryBinaryUpload } from '@lib/style-gallery-binary-upload';
import { getStyleGalleryPlatform } from '@lib/style-gallery-platforms';
import { getStyleGalleryCatalog } from '@lib/style-gallery-store';
import type { APIRoute } from 'astro';
import { z } from 'zod';
export const prerender = false;

export const POST: APIRoute = async ({ params, request, url }) => {
  const slug = params.slug;
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return new Response('Invalid style gallery slug.', { status: 400 });
  if (!isAuthorizedStyleGalleryRequest(request)) return new Response('Invalid upload token.', { status: 401 });

  try {
    const catalog = await getStyleGalleryCatalog();
    if (!catalog.items.some((item) => item.slug === slug))
      return new Response('Style gallery item not found.', { status: 404 });
    if (!getStyleGalleryPlatform(url.searchParams.get('platform') ?? '')) {
      return new Response('Invalid style gallery platform.', { status: 400 });
    }

    return await handleStyleGalleryBinaryUpload(request, url, 'example');
  } catch (error) {
    if (error instanceof z.ZodError) return new Response(error.message, { status: 400 });
    return new Response(error instanceof Error ? error.message : 'Failed to upload style gallery example.', { status: 500 });
  }
};
