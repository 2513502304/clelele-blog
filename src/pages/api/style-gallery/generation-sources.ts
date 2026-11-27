import { mapWithConcurrency } from '@lib/map-with-concurrency';
import { listGenerationJobs, resumeDraftCleanup } from '@lib/style-gallery-generation-jobs';
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
    const { slugs } = await readStudioSources(auth.owner);
    if (!new URL(request.url).searchParams.has('jobs')) return Response.json({ slugs }, { headers });
    // Resolve only this credential's registered sources, close to object storage.
    // One unavailable history should not hide the other ready outputs.
    const failed: string[] = [];
    const sources = await mapWithConcurrency(slugs, 4, async (slug) => {
      try {
        const scope = `${slug}/${auth.owner}`;
        const jobs = await listGenerationJobs(scope);
        resumeDraftCleanup(scope, jobs);
        return { slug, platform: auth.platform, jobs };
      } catch {
        failed.push(slug);
        return null;
      }
    });
    return Response.json({ slugs, sources: sources.filter(Boolean), failed }, { headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
};
