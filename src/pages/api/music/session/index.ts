import { isMusicAdmin } from '@lib/music/admin-auth';
import { getNeteaseSession, isMusicSessionStoreConfigured, toPublicNeteaseSessionStatus } from '@lib/music/session-store';
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  if (!isMusicAdmin(cookies)) return new Response('Not found.', { status: 404 });
  if (!isMusicSessionStoreConfigured()) {
    return Response.json(
      { configured: false, connected: false },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  try {
    return Response.json(toPublicNeteaseSessionStatus(await getNeteaseSession({ fresh: true })), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    console.error('[music] Failed to load the NetEase session status.', error);
    return new Response('Failed to load the NetEase session status.', { status: 503 });
  }
};
