import { hpoiConfig } from '@constants/site-config';
import { fetchHpoiCollection } from '@lib/hpoi';
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async () => {
  if (!hpoiConfig) return new Response('Hpoi collection is disabled.', { status: 404 });

  try {
    const data = await fetchHpoiCollection(hpoiConfig.userId);
    return Response.json(data, {
      headers: {
        // Vercel serves a fresh result for 30 minutes and can retain stale data while Hpoi is temporarily unavailable.
        'cache-control': 'public, s-maxage=1800, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('[hpoi] Failed to load collection:', error);
    return Response.json({ error: 'Failed to load Hpoi collection.' }, { status: 502 });
  }
};
