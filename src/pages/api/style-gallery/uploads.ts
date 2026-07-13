import { createStyleGallerySignedUploadUrl, deleteStyleGalleryObject, headStyleGalleryObject } from '@lib/hf-s3-presign';
import { getStyleGalleryItemAssetKeys, isStyleGalleryAssetKey } from '@lib/style-gallery-assets';
import { isAuthorizedStyleGalleryRequest } from '@lib/style-gallery-auth';
import { getStoredStyleGalleryItem, getStyleGalleryCatalog } from '@lib/style-gallery-store';
import type { APIRoute } from 'astro';
import { z } from 'zod';

export const prerender = false;

const requestSchema = z.object({
  token: z.string().optional(),
  action: z.enum(['prepare', 'cleanup']).default('prepare'),
  keys: z.array(z.string()).min(1).max(200),
});

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = requestSchema.parse(await request.json());
    if (!isAuthorizedStyleGalleryRequest(request, body.token)) return new Response('Invalid upload token.', { status: 401 });
    const keys = [...new Set(body.keys)];
    if (keys.some((key) => !isStyleGalleryAssetKey(key)))
      return new Response('Invalid style gallery asset key.', { status: 400 });

    if (body.action === 'cleanup') {
      const catalog = await getStyleGalleryCatalog({ fresh: true });
      const storedItems = await mapWithConcurrency(catalog.items, 8, (item) => getStoredStyleGalleryItem(item.slug));
      const referencedKeys = new Set(storedItems.filter((item) => item !== null).flatMap(getStyleGalleryItemAssetKeys));
      const removableKeys = keys.filter((key) => !referencedKeys.has(key));
      await Promise.all(removableKeys.map(deleteStyleGalleryObject));
      return Response.json({ deleted: removableKeys.length, retained: keys.length - removableKeys.length });
    }

    const uploads = await Promise.all(
      keys.map(async (key) => {
        const exists = await headStyleGalleryObject(key);
        return { key, exists, uploadUrl: exists ? undefined : createStyleGallerySignedUploadUrl(key) };
      }),
    );
    return Response.json({ uploads });
  } catch (error) {
    if (error instanceof z.ZodError) return new Response(error.message, { status: 400 });
    return new Response(error instanceof Error ? error.message : 'Failed to prepare style gallery uploads.', { status: 500 });
  }
};

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}
