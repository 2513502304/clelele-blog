import { hpoiConfig } from '@constants/site-config';
import type { APIRoute } from 'astro';
import { HPOI_CACHE_CONTROL, HPOI_CACHE_TAG } from '@/lib/hpoi/cache';
import { fetchHpoiRatings } from '@/lib/hpoi/fetch';

export const prerender = false;
/** Isolate optional per-figure reads from the latency-sensitive collection page, with the same refresh tag. */
export const GET: APIRoute = async ({ url }) => {
  if (!hpoiConfig) return new Response('Hpoi collection is disabled.', { status: 404 });
  const ids = [...new Set((url.searchParams.get('ids') ?? '').split(','))];
  if (!ids.length || ids.length > 24 || ids.some((id) => !/^[1-9]\d{0,9}$/.test(id)))
    return new Response('Invalid figure IDs.', { status: 400 });
  const ratings = await fetchHpoiRatings(ids);
  const complete = ids.every((id) => Object.hasOwn(ratings, id));
  return Response.json(ratings, {
    headers: { 'cache-control': complete ? HPOI_CACHE_CONTROL : 'no-store', 'vercel-cache-tag': HPOI_CACHE_TAG },
  });
};
