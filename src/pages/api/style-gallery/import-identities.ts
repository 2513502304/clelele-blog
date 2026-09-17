import { isAuthorizedStyleGalleryRequest } from '@lib/style-gallery-auth';
import { getStyleGalleryClientErrorResponse } from '@lib/style-gallery-errors';
import { rememberImportIdentities, replaceImportImageBatch, resolveImportIdentities } from '@lib/style-gallery-import-identity';
import { styleGalleryItemSchema, styleGalleryVisualRecordInputSchema } from '@lib/style-gallery-schema';
import type { APIRoute } from 'astro';
import { z } from 'zod';

export const prerender = false;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const slug = z.string().regex(/^[a-z0-9-]{1,160}$/i);
const hashes = z.array(hash).min(1).max(4);
const schema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('resolve'),
      queries: z
        .array(z.object({ hashes, legacySlug: slug }).strict())
        .min(1)
        .max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal('remember'),
      bindings: z
        .array(z.object({ hashes, slug, expectedHash: hash.optional() }).strict())
        .min(1)
        .max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal('replace'),
      replacements: z
        .array(
          z
            .object({
              slug,
              revision: hash,
              item: styleGalleryItemSchema,
              visualRecords: z.array(styleGalleryVisualRecordInputSchema).min(1).max(100),
              hashes,
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict(),
]);

/** CLI-only management: no public catalog growth and no GitHub-login mutation privilege. */
export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorizedStyleGalleryRequest(request)) return new Response('Invalid management token.', { status: 401 });
  try {
    const raw = await request.text();
    if (raw.length > 2_000_000) return new Response('Request too large.', { status: 413 });
    let body: z.infer<typeof schema>;
    try {
      body = schema.parse(JSON.parse(raw));
    } catch {
      return new Response('Invalid import identity request.', { status: 400 });
    }
    const result =
      body.action === 'resolve'
        ? await resolveImportIdentities(body.queries)
        : body.action === 'remember'
          ? await rememberImportIdentities(body.bindings)
          : await replaceImportImageBatch(body.replacements);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // Persisted JSON/schema failures are server failures, not malformed client requests.
    if (!getStyleGalleryClientErrorResponse(error))
      console.error('[style-gallery] Import identity operation failed:', error instanceof Error ? error.name : 'UnknownError');
    return (
      getStyleGalleryClientErrorResponse(error) ??
      new Response('Image identity operation failed. Retry after checking the current card.', { status: 500 })
    );
  }
};
