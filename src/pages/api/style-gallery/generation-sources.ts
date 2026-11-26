import { readStudioSources, studioOwner } from '@lib/style-gallery-studio-owner';
import type { APIRoute } from 'astro';

export const prerender = false;
/** Private discovery returns only the authenticated provider's source slugs. */
export const GET: APIRoute = async ({ request }) => {
  const auth = studioOwner(request);
  const headers = { 'cache-control': 'private, no-store', vary: 'X-API-Key, X-Gallery-Provider' };
  if (!auth) return new Response(null, { status: 401, headers });
  try {
    return Response.json({ slugs: (await readStudioSources(auth.owner)).slugs }, { headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
};
