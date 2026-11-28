import { isAuthorizedStyleGalleryRequest } from '@lib/style-gallery-auth';
import { repairExampleVisualIndex } from '@lib/style-gallery-visual-repair';
import type { APIRoute } from 'astro';

export const prerender = false;

/** Maintenance only; a retry reconciles published examples without touching the image or generation service. */
export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorizedStyleGalleryRequest(request)) return new Response(null, { status: 403 });
  return Response.json(await repairExampleVisualIndex(), { headers: { 'Cache-Control': 'no-store' } });
};
