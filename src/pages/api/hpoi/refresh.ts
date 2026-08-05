import { hpoiConfig } from '@constants/site-config';
import { refreshHpoiCollectionCache } from '@lib/hpoi/cache';
import { isSiteAdmin, rejectCrossOriginMutation } from '@lib/site-admin-auth';
import type { APIRoute } from 'astro';

export const prerender = false;

/** Owner-only 手动刷新：只有完整上游抓取成功后才删除现有 CDN 快照。 */
export const POST: APIRoute = async ({ cookies, request, url }) => {
  const originError = rejectCrossOriginMutation(request, url);
  if (originError) return originError;
  if (!isSiteAdmin(cookies)) return new Response('Not found.', { status: 404 });
  if (!hpoiConfig) return new Response('Hpoi collection is disabled.', { status: 404 });

  try {
    const data = await refreshHpoiCollectionCache(hpoiConfig.userId);
    return Response.json(data, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    console.error('[hpoi] Failed to refresh collection cache:', error);
    return new Response('Failed to refresh Hpoi collection.', {
      status: 502,
      headers: { 'cache-control': 'private, no-store' },
    });
  }
};
