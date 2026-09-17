import { isAuthorizedStyleGalleryRequest } from '@lib/style-gallery-auth';
import { getStyleGalleryClientErrorResponse } from '@lib/style-gallery-errors';
import { mergeGalleryCards, previewGalleryMerge } from '@lib/style-gallery-merge';
import { galleryTagsSchema } from '@lib/style-gallery-tag-store';
import type { APIRoute } from 'astro';
import { z } from 'zod';

export const prerender = false;
const side = z.union([z.literal(0), z.literal(1)]);
const prompt = z.object({ side, id: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const hashes = z.tuple([z.string().regex(/^[a-f0-9]{12,64}$/i), z.string().regex(/^[a-f0-9]{12,64}$/i)]);
const selection = z
  .object({
    keep: side,
    date: side,
    prompts: z.array(prompt).min(1).max(200),
    original: prompt.nullable(),
    examples: z.array(side).max(2),
    tags: galleryTagsSchema,
  })
  .strict();
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), hashes }).strict(),
  z
    .object({
      action: z.literal('merge'),
      hashes,
      revisions: z.tuple([z.string().length(64), z.string().length(64)]),
      selection,
    })
    .strict(),
]);

/** Both comparison and mutation require the shared management credential; public GitHub likes confer no edit rights. */
export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorizedStyleGalleryRequest(request)) return new Response('Invalid management token.', { status: 401 });
  try {
    const raw = await request.text();
    if (raw.length > 32_000) return new Response('Merge request too large.', { status: 413 });
    let body: z.infer<typeof schema>;
    try {
      body = schema.parse(JSON.parse(raw));
    } catch {
      return new Response('Invalid merge selection.', { status: 400 });
    }
    const result =
      body.action === 'preview'
        ? await previewGalleryMerge(body.hashes)
        : await mergeGalleryCards(body.hashes, body.revisions, body.selection);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = getStyleGalleryClientErrorResponse(error);
    if (response) return response;
    console.error('[style-gallery] Merge failed:', error instanceof Error ? error.name : 'UnknownError');
    return new Response('Merge failed. Reload the comparison before retrying.', { status: 500 });
  }
};
