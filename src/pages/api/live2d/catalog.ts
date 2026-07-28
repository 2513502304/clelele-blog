import { live2dEnabled } from '@constants/site-config';
import { getLive2DReadS3Config } from '@lib/live2d/assets';
import { createLive2DRemoteMetadataStore } from '@lib/live2d/metadata-store';
import type { APIRoute } from 'astro';

export const prerender = false;

const metadata = createLive2DRemoteMetadataStore(() => getLive2DReadS3Config(process.env));

/** Mutable metadata gets a short CDN TTL; immutable model members retain their one-year cache. */
export const GET: APIRoute = async () => {
  if (!live2dEnabled && process.env.LIVE2D_ASSET_DELIVERY_MODE !== 'enabled') {
    return new Response('Live2D catalog not found.', { status: 404 });
  }
  try {
    const catalog = await metadata.getCatalog();
    return Response.json(catalog, {
      headers: {
        'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
        'vercel-cdn-cache-control': 'public, max-age=300, stale-while-revalidate=3600',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return new Response('Live2D catalog unavailable.', {
      status: 503,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  }
};
