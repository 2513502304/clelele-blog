import type { APIRoute } from 'astro';
import { getSiteProfile } from '../../../lib/site-profile/store';
export const prerender = false;
export const GET: APIRoute = async () => {
  try {
    const { history: _, ...profile } = await getSiteProfile();
    return Response.json(profile, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=60' },
    });
  } catch {
    return new Response('Profile unavailable.', { status: 503 });
  }
};
