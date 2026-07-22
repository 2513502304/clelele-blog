import { getStyleGalleryViewer, isStyleGalleryGitHubAuthEnabled } from '@lib/style-gallery-github-auth';
import { getStyleGalleryViewerLikedExampleIds, setStyleGalleryExampleLike } from '@lib/style-gallery-likes';
import { getStyleGalleryExampleIndex } from '@lib/style-gallery-store';
import type { APIRoute } from 'astro';
import { z } from 'zod';

export const prerender = false;

const mutationSchema = z.object({
  exampleId: z.string().regex(/^[a-z0-9-]+$/i),
  liked: z.boolean(),
});

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const viewer = getStyleGalleryViewer(cookies);
    const index = viewer ? await getStyleGalleryExampleIndex() : null;
    return Response.json(
      {
        authEnabled: isStyleGalleryGitHubAuthEnabled(),
        viewer,
        likedExampleIds: viewer && index ? getStyleGalleryViewerLikedExampleIds(index, viewer.id) : [],
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Failed to load style gallery likes.', { status: 503 });
  }
};

export const PUT: APIRoute = async ({ cookies, request, url }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return new Response('Invalid request origin.', { status: 403 });
  if (!isStyleGalleryGitHubAuthEnabled()) return new Response('GitHub login is not configured.', { status: 503 });
  const viewer = getStyleGalleryViewer(cookies);
  if (!viewer) return new Response('GitHub login is required.', { status: 401 });

  try {
    const body = mutationSchema.parse(await request.json());
    const result = await setStyleGalleryExampleLike({ ...body, userId: viewer.id });
    return Response.json({ ...result, viewer }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof z.ZodError) return new Response(error.message, { status: 400 });
    if (error instanceof Error && error.message.startsWith('Style gallery example not found:')) {
      return new Response(error.message, { status: 404 });
    }
    return new Response(error instanceof Error ? error.message : 'Failed to update style gallery like.', { status: 503 });
  }
};
