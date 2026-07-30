import { isMusicAdmin, rejectCrossOriginMutation } from '@lib/music/admin-auth';
import { createNeteaseQrLogin } from '@lib/music/netease-api';
import { isMusicSessionStoreConfigured } from '@lib/music/session-store';
import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, request, url }) => {
  const originError = rejectCrossOriginMutation(request, url);
  if (originError) return originError;
  if (!isMusicAdmin(cookies)) return new Response('Not found.', { status: 404 });
  if (!isMusicSessionStoreConfigured()) return new Response('Music session storage is not configured.', { status: 503 });
  try {
    return Response.json(await createNeteaseQrLogin(), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[music] Failed to create a NetEase QR login.', error);
    return new Response('Failed to create a NetEase QR login.', { status: 503 });
  }
};
