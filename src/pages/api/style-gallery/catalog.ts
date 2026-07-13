import { getStyleGalleryCatalog } from '@lib/style-gallery-store';
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const catalog = await getStyleGalleryCatalog();
    return Response.json(catalog, {
      headers: {
        'cache-control': 'public, s-maxage=30, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Failed to load style gallery catalog.', { status: 503 });
  }
};
