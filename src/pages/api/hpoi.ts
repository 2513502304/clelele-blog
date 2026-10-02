import { hpoiConfig } from '@constants/site-config';
import { HPOI_CACHE_CONTROL, HPOI_CACHE_TAG } from '@lib/hpoi/cache';
import { fetchHpoiCollection, fetchHpoiPage } from '@lib/hpoi/fetch';
import type { APIRoute } from 'astro';
import { HPOI_COLLECTION_STATES, type HpoiCollectionState } from '@/types/hpoi';

export const prerender = false;
/** Query-specific CDN entries retain the existing TTL and owner refresh tag. */
export const GET: APIRoute = async ({ url }) => {
  if (!hpoiConfig) return new Response('Hpoi collection is disabled.', { status: 404 });
  const state = url.searchParams.get('state') ?? 'all';
  const page = Number(url.searchParams.get('page') ?? 1);
  const pages = Number(url.searchParams.get('pages') ?? 1);
  if (
    !(HPOI_COLLECTION_STATES as readonly string[]).includes(state) ||
    !Number.isSafeInteger(page) ||
    !Number.isSafeInteger(pages) ||
    page < 1 ||
    pages < page ||
    pages > 100
  )
    return new Response('Invalid page', { status: 400 });
  try {
    // Preserve the existing full-snapshot contract for the owner cache dashboard.
    const data = url.searchParams.has('state')
      ? await fetchHpoiPage(hpoiConfig.userId, state as HpoiCollectionState, page, pages)
      : await fetchHpoiCollection(hpoiConfig.userId);
    return Response.json(data, {
      headers: {
        'cache-control': HPOI_CACHE_CONTROL,
        'vercel-cache-tag': HPOI_CACHE_TAG,
      },
    });
  } catch (error) {
    console.error('[hpoi] Failed to load page:', error);
    return Response.json({ error: 'Failed to load Hpoi collection.' }, { status: 502 });
  }
};
