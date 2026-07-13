import { isAuthorizedStyleGalleryRequest } from '@lib/style-gallery-auth';
import { getStyleGalleryClientErrorResponse } from '@lib/style-gallery-errors';
import { styleGalleryItemSchema } from '@lib/style-gallery-schema';
import { writeStyleGalleryItems } from '@lib/style-gallery-write';
import type { APIRoute } from 'astro';
import { z } from 'zod';

export const prerender = false;

const requestSchema = z.object({
  token: z.string().optional(),
  mode: z.enum(['create', 'upsert']).default('create'),
  items: z.array(styleGalleryItemSchema).min(1).max(100),
});

export const POST: APIRoute = async ({ request }) => {
  try {
    const rawBody = await request.json();
    if (!isAuthorizedStyleGalleryRequest(request, rawBody?.token))
      return new Response('Invalid upload token.', { status: 401 });
    const body = requestSchema.parse(rawBody);
    const result = await writeStyleGalleryItems(body.items, body.mode);
    return Response.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return new Response(error.message, { status: 400 });
    const clientErrorResponse = getStyleGalleryClientErrorResponse(error);
    if (clientErrorResponse) return clientErrorResponse;
    return new Response(error instanceof Error ? error.message : 'Failed to write style gallery items.', { status: 500 });
  }
};
