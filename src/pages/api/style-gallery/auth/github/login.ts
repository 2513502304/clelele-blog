import {
  createStyleGalleryOAuthFlow,
  getStyleGalleryOAuthChallenge,
  getStyleGalleryOAuthRedirectUri,
  isStyleGalleryGitHubAuthEnabled,
  setStyleGalleryOAuthFlowCookie,
} from '@lib/style-gallery-github-auth';
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ cookies, redirect, url }) => {
  if (!isStyleGalleryGitHubAuthEnabled()) return new Response('GitHub login is not configured.', { status: 503 });
  const flow = createStyleGalleryOAuthFlow(url.searchParams.get('returnTo') ?? '');
  setStyleGalleryOAuthFlowCookie(cookies, url, flow);
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', process.env.STYLE_GALLERY_GITHUB_CLIENT_ID ?? '');
  authorizeUrl.searchParams.set('redirect_uri', getStyleGalleryOAuthRedirectUri(url));
  authorizeUrl.searchParams.set('state', flow.state);
  authorizeUrl.searchParams.set('code_challenge', getStyleGalleryOAuthChallenge(flow.verifier));
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  return redirect(authorizeUrl.toString(), 302);
};
