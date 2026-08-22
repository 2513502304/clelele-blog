import { isAuthorizedStyleGalleryRequest } from '@lib/style-gallery-auth';
import { getStyleGalleryClientErrorResponse, StyleGalleryClientError } from '@lib/style-gallery-errors';
import { styleGalleryItemSchema, styleGalleryVisualRecordInputSchema } from '@lib/style-gallery-schema';
import { mutateStyleGalleryVisualIndex } from '@lib/style-gallery-store';
import { planStyleGallerySourceVisualRecords, replaceStyleGallerySourceVisualRecords } from '@lib/style-gallery-visual-index';
import { writeStyleGalleryItems } from '@lib/style-gallery-write';
import type { APIRoute } from 'astro';
import { z } from 'zod';

export const prerender = false;

const requestSchema = z.object({
  token: z.string().optional(),
  mode: z.enum(['create', 'upsert']).default('create'),
  items: z.array(styleGalleryItemSchema).min(1).max(100),
  // 100 个 item 可能各含多张参考图；5000 条紧凑特征仍低于 Vercel 请求体上限，并避免合法批次被误拒。
  visualRecords: z.array(styleGalleryVisualRecordInputSchema).min(1).max(5000),
});

export const POST: APIRoute = async ({ request }) => {
  try {
    const rawBody = await request.json();
    if (!isAuthorizedStyleGalleryRequest(request, rawBody?.token))
      return new Response('Invalid upload token.', { status: 401 });
    const body = requestSchema.parse(rawBody);
    assertSourceVisualRecords(body.items, body.visualRecords);
    const result = await writeStyleGalleryItems(body.items, body.mode);
    let visualIndexUpdated = true;
    try {
      const { touchedSlugs, activeRecords } = planStyleGallerySourceVisualRecords(body.items, result.items, body.visualRecords);
      await mutateStyleGalleryVisualIndex((current) =>
        replaceStyleGallerySourceVisualRecords(current, touchedSlugs, activeRecords),
      );
    } catch (error) {
      // item/catalog 已经成功提交，视觉索引作为可重建派生数据不能反向回滚真相源。
      visualIndexUpdated = false;
      console.error('[style-gallery] Source items were saved but the visual index update failed.', error);
    }
    return Response.json({ ...result, visualIndexUpdated });
  } catch (error) {
    if (error instanceof z.ZodError) return new Response(error.message, { status: 400 });
    const clientErrorResponse = getStyleGalleryClientErrorResponse(error);
    if (clientErrorResponse) return clientErrorResponse;
    return new Response(error instanceof Error ? error.message : 'Failed to write style gallery items.', { status: 500 });
  }
};

function assertSourceVisualRecords(
  items: z.infer<typeof styleGalleryItemSchema>[],
  records: z.infer<typeof styleGalleryVisualRecordInputSchema>[],
): void {
  const expected = new Set(items.flatMap((item) => item.images.map((image) => `${item.slug}\n${image.imageHash}`)));
  const actual = new Set<string>();
  for (const record of records) {
    if (record.kind !== 'source' || record.imageId !== record.feature.imageHash) {
      throw new StyleGalleryClientError('Source visual record identity does not match its image feature.', 400);
    }
    actual.add(`${record.sourceSlug}\n${record.feature.imageHash}`);
  }
  if (
    records.length !== expected.size ||
    expected.size !== actual.size ||
    [...expected].some((identity) => !actual.has(identity))
  ) {
    throw new StyleGalleryClientError('Source visual records do not match submitted item images.', 400);
  }
}
