import { isAuthorizedStyleGalleryRequest } from '@lib/style-gallery-auth';
import { handleStyleGalleryBinaryUpload } from '@lib/style-gallery-binary-upload';
import type { APIRoute } from 'astro';
import { z } from 'zod';

export const prerender = false;
/** Reuse bounded, hash-verified direct/chunk uploads for manually collected source images. */
export const POST: APIRoute = async ({ request, url }) => {
  if (!isAuthorizedStyleGalleryRequest(request)) return new Response('Invalid management token.', { status: 401 });
  try {
    return await handleStyleGalleryBinaryUpload(request, url, 'source');
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return new Response('Invalid upload.', { status: 400 });
    console.error('[style-gallery] Source upload failed.', error);
    return new Response('Unable to upload image. Please retry.', { status: 500 });
  }
};
