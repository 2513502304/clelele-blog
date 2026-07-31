import { isMusicAdmin, rejectCrossOriginMutation } from '@lib/music/admin-auth';
import { checkMusicSessionHealth } from '@lib/music/service';
import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, request, url }) => {
  const originError = rejectCrossOriginMutation(request, url);
  if (originError) return originError;
  if (!isMusicAdmin(cookies)) return new Response('Not found.', { status: 404 });
  try {
    return Response.json(await checkMusicSessionHealth(), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[music] NetEase health check failed.', error);
    return new Response('NetEase health check failed.', { status: 503 });
  }
};
