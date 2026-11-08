import { dangerouslyDeleteByTag, invalidateByTag } from '@vercel/functions';

/** Preserve tag invalidation after durable writes on either hosting platform. */
export async function invalidateCdnTags(tags: string | string[], mode: 'invalidate' | 'purge' = 'invalidate'): Promise<void> {
  const endpoint = process.env.BLOG_CACHE_INVALIDATION_URL;
  if (!endpoint) {
    // A misconfigured container must not silently use Vercel's local no-op path.
    if (process.env.DEPLOY_TARGET === 'cloudflare-container') throw new Error('Cloudflare cache endpoint is missing.');
    await (mode === 'purge' ? dangerouslyDeleteByTag(tags) : invalidateByTag(tags));
    return;
  }
  const token = process.env.BLOG_CACHE_INVALIDATION_TOKEN;
  if (!token || new URL(endpoint).protocol !== 'https:') throw new Error('Cloudflare cache credentials are missing.');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, tags: [...new Set(typeof tags === 'string' ? [tags] : tags)] }),
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Cloudflare cache invalidation failed (${response.status}).`);
  await response.body?.cancel();
}
