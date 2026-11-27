import { getStyleGalleryViewer, isStyleGalleryGitHubAuthEnabled } from '@lib/style-gallery-github-auth';
import { listAccountSources } from '@lib/style-gallery-studio-account';
import { readStudioSources, studioOwner } from '@lib/style-gallery-studio-owner';
import type { APIRoute } from 'astro';

export const prerender = false;
/** Discover only the current account's linked works or the current provider credential's source slugs. */
export const GET: APIRoute = async ({ request, cookies }) => {
  const auth = studioOwner(request);
  const headers = { 'cache-control': 'private, no-store', vary: 'Cookie, X-API-Key, X-Gallery-Provider' };
  try {
    if (new URL(request.url).searchParams.has('account')) {
      const viewer = getStyleGalleryViewer(cookies);
      return Response.json(
        {
          sources: viewer ? await listAccountSources(viewer.id) : [],
          signedIn: Boolean(viewer),
          loginEnabled: isStyleGalleryGitHubAuthEnabled(),
        },
        { headers },
      );
    }
    if (!auth) return new Response(null, { status: 401, headers });
    return Response.json({ slugs: (await readStudioSources(auth.owner)).slugs }, { headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
};
