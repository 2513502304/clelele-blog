import { getStyleGalleryViewer, isStyleGalleryGitHubAuthEnabled } from '@lib/style-gallery-github-auth';
import type { AstroCookies } from 'astro';

export function getMusicAdminGitHubId(): number {
  const parsed = Number.parseInt(process.env.MUSIC_ADMIN_GITHUB_ID ?? '129171955', 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('MUSIC_ADMIN_GITHUB_ID must be a positive GitHub user ID.');
  return parsed;
}

export function isMusicAdmin(cookies: AstroCookies): boolean {
  return getStyleGalleryViewer(cookies)?.id === getMusicAdminGitHubId();
}

export function isMusicAdminLoginConfigured(): boolean {
  return isStyleGalleryGitHubAuthEnabled();
}

export function rejectCrossOriginMutation(request: Request, requestUrl: URL): Response | null {
  const origin = request.headers.get('origin');
  return origin && origin !== requestUrl.origin ? new Response('Invalid request origin.', { status: 403 }) : null;
}
