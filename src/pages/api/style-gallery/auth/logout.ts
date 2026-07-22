import { clearStyleGallerySession, normalizeStyleGalleryReturnTo } from '@lib/style-gallery-github-auth';
import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect, request, url }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return new Response('Invalid request origin.', { status: 403 });
  clearStyleGallerySession(cookies);
  const body = await request.formData().catch(() => null);
  return redirect(normalizeStyleGalleryReturnTo(body?.get('returnTo')?.toString()), 303);
};
