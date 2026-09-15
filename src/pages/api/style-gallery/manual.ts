import { createHash } from 'node:crypto';
import { getStyleGalleryObjectBytes, headStyleGalleryObject, putStyleGalleryObject } from '@lib/hf-s3-presign';
import { isAuthorizedStyleGalleryRequest } from '@lib/style-gallery-auth';
import { MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE } from '@lib/style-gallery-chunk-upload';
import { getStyleGalleryClientErrorResponse } from '@lib/style-gallery-errors';
import { readStyleGalleryImageDimensions } from '@lib/style-gallery-image-dimensions';
import { createManualStyleGalleryItem } from '@lib/style-gallery-manual-item';
import { styleGalleryVisualRecordInputSchema } from '@lib/style-gallery-schema';
import { getStoredStyleGalleryItem, getStyleGalleryCatalog, mutateStyleGalleryVisualIndex } from '@lib/style-gallery-store';
import { galleryTagsSchema, setGalleryTags } from '@lib/style-gallery-tag-store';
import { upsertStyleGalleryVisualRecords } from '@lib/style-gallery-visual-index';
import { writeStyleGalleryItems } from '@lib/style-gallery-write';
import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { z } from 'zod';

export const prerender = false;
const schema = z
  .object({
    imageHash: z.string().regex(/^[a-f0-9]{64}$/),
    extension: z.enum(['jpg', 'png', 'webp']),
    prompt: z.string().trim().min(1).max(100_000),
    originalPrompt: z.string().max(20_000).optional(),
    tags: galleryTagsSchema.optional(),
    model: z.string().trim().max(120).optional(),
    feature: styleGalleryVisualRecordInputSchema.shape.feature,
  })
  .strict();

/** Publish metadata only after verified source and thumbnail exist; normal page reads do no extra work. */
export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorizedStyleGalleryRequest(request)) return new Response('Invalid management token.', { status: 401 });
  try {
    const text = await request.text();
    if (text.length > 140_000) return new Response('Metadata is too large.', { status: 413 });
    const body = schema.parse(JSON.parse(text));
    if (body.feature.imageHash !== body.imageHash) return new Response('Feature hash does not match.', { status: 400 });
    const catalog = await getStyleGalleryCatalog({ fresh: true });
    const existing = catalog.items.find((item) => item.imageHash === body.imageHash);
    const shortHash = body.imageHash.slice(0, 12);
    const bytes = await getStyleGalleryObjectBytes(`source/${shortHash}.${body.extension}`);
    if (!bytes || !bytes.length || bytes.length > MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE)
      return new Response('Uploaded image is missing or too large.', { status: 400 });
    if (createHash('sha256').update(bytes).digest('hex') !== body.imageHash)
      return new Response('Uploaded image hash does not match.', { status: 409 });
    const metadata = await sharp(bytes).metadata();
    if (metadata.format !== (body.extension === 'jpg' ? 'jpeg' : body.extension))
      return new Response('Image format does not match its extension.', { status: 400 });
    const dimensions = await readStyleGalleryImageDimensions(bytes);
    const thumbnailKey = `thumb/${shortHash}.webp`;
    if (!(await headStyleGalleryObject(thumbnailKey))) {
      const thumbnail = await sharp(bytes)
        .rotate()
        .resize({ width: 720, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      await putStyleGalleryObject(thumbnailKey, thumbnail, 'image/webp');
    }
    let item = createManualStyleGalleryItem({ ...body, dimensions });
    if (existing) {
      const stored = await getStoredStyleGalleryItem(existing.slug, { fresh: true });
      if (!stored) return new Response('Existing item is unavailable. Please retry.', { status: 409 });
      item = { ...stored, examples: [], prompts: item.prompts };
    }
    const result = await writeStyleGalleryItems([item], 'create');
    const slug = result.items[0]?.slug ?? existing?.slug ?? item.slug;
    // Retry also repairs a failed index publication, without adding another item or variant.
    let visualIndexUpdated = true;
    try {
      await mutateStyleGalleryVisualIndex((current) =>
        // An existing collection may contain more source images; update only the uploaded image.
        upsertStyleGalleryVisualRecords(current, [
          { kind: 'source', sourceSlug: slug, imageId: body.imageHash, feature: body.feature },
        ]),
      );
    } catch (error) {
      visualIndexUpdated = false;
      console.error('[style-gallery] Manual item saved; visual index needs retry.', error);
    }
    let tagsUpdated = true;
    if (body.tags?.length) {
      try {
        // Additive and idempotent: collecting an existing image never replaces its categories.
        await setGalleryTags({ slugs: [slug], tags: body.tags });
      } catch (error) {
        tagsUpdated = false;
        console.error('[style-gallery] Manual item saved; tags need retry.', error);
      }
    }
    return Response.json(
      { slug, created: result.created > 0, visualIndexUpdated, tagsUpdated },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return new Response('Invalid collection details.', { status: 400 });
    console.error('[style-gallery] Manual collection failed.', error);
    return (
      getStyleGalleryClientErrorResponse(error) ?? new Response('Unable to save collection. Please retry.', { status: 500 })
    );
  }
};
