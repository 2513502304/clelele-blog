import { STYLE_GALLERY_LIST_CACHE_TAG, setStyleGalleryPublicCacheHeaders } from '@lib/style-gallery-public-cache';
import { getStyleGalleryCatalog } from '@lib/style-gallery-store';
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const catalog = await getStyleGalleryCatalog();
    const headers = new Headers();
    setStyleGalleryPublicCacheHeaders(headers, [STYLE_GALLERY_LIST_CACHE_TAG]);
    return Response.json(catalog, { headers });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Failed to load style gallery catalog.', { status: 503 });
  }
};
