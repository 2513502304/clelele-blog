import { createFallbackAudioUrl, isValidNeteaseSongId, resolveAuthenticatedAudioUrl } from '@lib/music/service';
import type { APIRoute } from 'astro';

export const prerender = false;

/** Authenticated URL failures are deliberately non-fatal: every request retains the previous Meting playback path. */
export const GET: APIRoute = async ({ url }) => {
  const songId = url.searchParams.get('id') ?? '';
  if (!isValidNeteaseSongId(songId)) return new Response('Invalid NetEase song ID.', { status: 400 });

  let target: string | null = null;
  let source = 'fallback';
  try {
    target = await resolveAuthenticatedAudioUrl(songId);
    if (target) source = 'authenticated';
  } catch (error) {
    console.warn(`[music] Authenticated audio resolution failed for song ${songId}; using fallback.`, error);
  }
  target ??= createFallbackAudioUrl(songId);
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      'Cache-Control': 'private, no-store',
      'X-Music-Source': source,
    },
  });
};
