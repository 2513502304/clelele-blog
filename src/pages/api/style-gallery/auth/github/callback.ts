import {
  authenticateStyleGalleryGitHubUser,
  getStyleGalleryOAuthRedirectUri,
  setStyleGallerySession,
  takeStyleGalleryOAuthFlow,
} from '@lib/style-gallery-github-auth';
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ cookies, redirect, url }) => {
  const flow = takeStyleGalleryOAuthFlow(cookies);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!flow || !code || !state || state !== flow.state) {
    return new Response('Invalid or expired GitHub login flow.', { status: 400 });
  }

  try {
    const viewer = await authenticateStyleGalleryGitHubUser({
      code,
      verifier: flow.verifier,
      redirectUri: getStyleGalleryOAuthRedirectUri(url),
    });
    setStyleGallerySession(cookies, url, viewer);
    return redirect(flow.returnTo, 302);
  } catch (error) {
    console.error('[style-gallery] GitHub OAuth callback failed.', error);
    const target = new URL(flow.returnTo, url.origin);
    target.searchParams.set('loginError', 'github');
    return redirect(`${target.pathname}${target.search}${target.hash}`, 302);
  }
};
