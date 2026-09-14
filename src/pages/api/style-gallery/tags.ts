import { getStyleGalleryViewer, isStyleGalleryGitHubAuthEnabled } from '@lib/style-gallery-github-auth';
import { setStyleGalleryPublicCacheHeaders } from '@lib/style-gallery-public-cache';
import {
  GalleryTagWriteError,
  galleryTagMutationSchema,
  getGalleryTagIndex,
  STYLE_GALLERY_TAG_CACHE_TAG,
  setGalleryTags,
} from '@lib/style-gallery-tag-store';
import type { APIRoute } from 'astro';
import { z } from 'zod';

export const prerender = false;

/** Public display is CDN cached; editing reads fresh data using the existing signed GitHub session. */
export const GET: APIRoute = async ({ cookies, url }) => {
  const editing = url.searchParams.get('edit') === '1';
  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  if (editing && !getStyleGalleryViewer(cookies)) return new Response('GitHub login is required.', { status: 401, headers });
  try {
    const index = await getGalleryTagIndex();
    if (!editing) setStyleGalleryPublicCacheHeaders(headers, [STYLE_GALLERY_TAG_CACHE_TAG]);
    return Response.json(index, { headers });
  } catch (error) {
    console.error('[style-gallery] Failed to read tags.', error);
    return new Response('Tags are temporarily unavailable.', { status: 503, headers });
  }
};

export const PUT: APIRoute = async ({ cookies, request, url }) => {
  const headers = { 'Cache-Control': 'private, no-store' };
  // Cookie-authenticated writes require an explicit same-origin browser request, including on localhost.
  if (request.headers.get('origin') !== url.origin) return new Response('Invalid request origin.', { status: 403, headers });
  if (!isStyleGalleryGitHubAuthEnabled() || !getStyleGalleryViewer(cookies))
    return new Response('GitHub login is required.', { status: 401, headers });
  try {
    const reader = request.body?.getReader();
    if (!reader) return new Response('Missing body.', { status: 400, headers });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return new Response('Request too large.', { status: 413, headers });
      }
      chunks.push(value);
    }
    const body = galleryTagMutationSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    return Response.json(await setGalleryTags(body), { headers });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return new Response('Invalid tag data.', { status: 400, headers });
    if (error instanceof GalleryTagWriteError) return new Response(error.message, { status: error.status, headers });
    console.error('[style-gallery] Failed to save tags.', error);
    return new Response('Could not save tags. Please retry.', { status: 503, headers });
  }
};
