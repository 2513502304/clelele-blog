import type { APIRoute } from 'astro';
import { assetSlotSchema } from '../../../lib/site-profile/schema';
import { getSiteProfile, siteProfileStorage } from '../../../lib/site-profile/store';
export const prerender = false;
/** Slot aliases stay fresh; immutable history keys share cached bytes across routes and fallback banners. */
export const GET: APIRoute = async ({ params, request }) => {
  try {
    const profile = await getSiteProfile();
    const slot = assetSlotSchema.safeParse(params.asset);
    // History is addressable only by a validated recorded hash, not by arbitrary HF object keys.
    const key = slot.success
      ? (profile.assets[slot.data] ?? profile.assets.home)
      : profile.history.find((entry) => entry.key.split('/')[1] === params.asset)?.key;
    if (!key) return new Response('Not found.', { status: 404 });
    if (slot.success)
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/api/site-assets/${key.split('/')[1]}`,
          'Cache-Control': 'public, max-age=30, s-maxage=30',
        },
      });
    // A signed URL changes with time and defeats the browser image cache. Keep credentials
    // server-side and serve the recorded immutable image under one stable same-origin URL.
    const headers = {
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      ETag: `"${params.asset}"`,
      'X-Content-Type-Options': 'nosniff',
    };
    if (request.headers.get('if-none-match') === headers.ETag) return new Response(null, { status: 304, headers });
    const image = await siteProfileStorage().get(key);
    if (!image) return new Response('Not found.', { status: 404 });
    const extension = key.split('.').pop();
    // Keep large banners on the streaming response path instead of a buffered serverless payload.
    return new Response(new Blob([new Uint8Array(image.bytes)]).stream(), {
      headers: { ...headers, 'Content-Type': `image/${extension === 'jpg' ? 'jpeg' : extension}` },
    });
  } catch {
    return new Response('Image unavailable.', { status: 503 });
  }
};
