import { createHash } from 'node:crypto';
import { putStyleGalleryObject } from '@lib/hf-s3-presign';
import { isAuthorizedStyleGalleryRequest } from '@lib/style-gallery-auth';
import { getStyleGalleryExampleKey, MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE } from '@lib/style-gallery-example-upload';
import { getStyleGalleryPlatform } from '@lib/style-gallery-platforms';
import { getStyleGalleryCatalog } from '@lib/style-gallery-store';
import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ params, request, url }) => {
  const slug = params.slug;
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return new Response('Invalid style gallery slug.', { status: 400 });
  if (!isAuthorizedStyleGalleryRequest(request)) return new Response('Invalid upload token.', { status: 401 });
  const catalog = await getStyleGalleryCatalog();
  if (!catalog.items.some((item) => item.slug === slug)) return new Response('Style gallery item not found.', { status: 404 });

  const platform = getStyleGalleryPlatform(url.searchParams.get('platform') ?? '');
  const expectedHash = url.searchParams.get('hash') ?? '';
  const extension = (url.searchParams.get('extension') ?? '').toLowerCase();
  if (!platform || !/^[a-f0-9]{64}$/i.test(expectedHash) || !/^(jpg|png|webp)$/i.test(extension)) {
    return new Response('Invalid example upload metadata.', { status: 400 });
  }
  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE) {
    return new Response('Image is too large.', { status: 413 });
  }

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) return new Response('No image was uploaded.', { status: 400 });
    if (bytes.length > MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE) return new Response('Image is too large.', { status: 413 });
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== expectedHash) return new Response('Image hash does not match the prepared upload.', { status: 409 });
    const key = getStyleGalleryExampleKey(actualHash, extension);
    await putStyleGalleryObject(key, bytes, request.headers.get('content-type') ?? 'application/octet-stream');
    return Response.json({ key, imageHash: actualHash });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Failed to upload style gallery example.', { status: 500 });
  }
};
