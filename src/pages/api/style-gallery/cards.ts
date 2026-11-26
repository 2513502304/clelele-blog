import { getStyleGalleryData, toStyleGalleryCardDataList } from '@lib/style-gallery';
import { STYLE_GALLERY_LIST_CACHE_TAG, setStyleGalleryPublicCacheHeaders } from '@lib/style-gallery-public-cache';
import type { APIRoute } from 'astro';

export const prerender = false;

/** Ordinary browsing reads bounded pages. Filters and bulk actions explicitly request the full list. */
export const GET: APIRoute = async ({ url }) => {
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) return new Response(null, { status: 400 });
  try {
    const gallery = await getStyleGalleryData();
    // A mutation between pages can shift offsets. Replace the snapshot atomically instead of splicing two revisions.
    const full = url.searchParams.get('all') === '1' || url.searchParams.get('revision') !== gallery.updatedAt;
    const start = full ? 0 : offset;
    const items = toStyleGalleryCardDataList(gallery, start, full ? undefined : start + 72);
    const headers = new Headers();
    setStyleGalleryPublicCacheHeaders(headers, [STYLE_GALLERY_LIST_CACHE_TAG]);
    return Response.json({ items, start, total: gallery.items.length, revision: gallery.updatedAt }, { headers });
  } catch {
    return new Response('Gallery unavailable', { status: 503 });
  }
};
