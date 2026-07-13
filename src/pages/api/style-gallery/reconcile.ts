import { isAuthorizedStyleGalleryRequest } from '@lib/style-gallery-auth';
import { reconcileStyleGalleryExampleCounts } from '@lib/style-gallery-write';
import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorizedStyleGalleryRequest(request)) return new Response('Invalid upload token.', { status: 401 });
  try {
    return Response.json(await reconcileStyleGalleryExampleCounts());
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Failed to reconcile style gallery metadata.', {
      status: 500,
    });
  }
};
