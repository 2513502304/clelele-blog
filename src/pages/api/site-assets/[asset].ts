import type { APIRoute } from 'astro';
import { assetSlotSchema } from '../../../lib/site-profile/schema';
import { getSiteProfile, siteProfileStorage } from '../../../lib/site-profile/store';
export const prerender = false;
export const GET: APIRoute = async ({ params }) => {
  try {
    const profile = await getSiteProfile();
    const slot = assetSlotSchema.safeParse(params.asset);
    // History is addressable only by a validated recorded hash, not by arbitrary HF object keys.
    const key = slot.success
      ? (profile.assets[slot.data] ?? profile.assets.home)
      : profile.history.find((entry) => entry.key.split('/')[1] === params.asset)?.key;
    if (!key) return new Response('Not found.', { status: 404 });
    return new Response(null, {
      status: 302,
      headers: {
        Location: siteProfileStorage().presign('GET', key, 3600),
        'Cache-Control': slot.success ? 'public, max-age=0, s-maxage=30' : 'public, max-age=1800, s-maxage=1800',
      },
    });
  } catch {
    return new Response('Image unavailable.', { status: 503 });
  }
};
