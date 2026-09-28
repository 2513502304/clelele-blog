import type { APIRoute } from 'astro';
import { isSiteAdmin } from '../../../lib/site-admin-auth';
import { assetKeySchema } from '../../../lib/site-profile/schema';
import { getSiteProfile, siteProfileStorage } from '../../../lib/site-profile/store';
export const prerender = false;
/** Same-origin bytes let the owner's crop canvas read a historical image without CORS-tainted exports. */
export const GET: APIRoute = async ({ cookies, url }) => {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!isSiteAdmin(cookies)) return new Response('Not found.', { status: 404, headers });
  const key = assetKeySchema.safeParse(url.searchParams.get('key'));
  if (!key.success) return new Response('Not found.', { status: 404, headers });
  try {
    const profile = await getSiteProfile(true);
    if (!profile.history.some((asset) => asset.key === key.data)) return new Response('Not found.', { status: 404, headers });
    const object = await siteProfileStorage().get(key.data);
    if (!object) return new Response('Not found.', { status: 404, headers });
    const extension = key.data.split('.').at(-1);
    return new Response(new Uint8Array(object.bytes).buffer, {
      headers: { ...headers, 'Content-Type': `image/${extension === 'jpg' ? 'jpeg' : extension}` },
    });
  } catch {
    return new Response('Image unavailable.', { status: 503, headers });
  }
};
