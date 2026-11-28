import { overviewPage } from '@lib/style-gallery-overview-pages';
import { getOverviewSnapshot } from '@lib/style-gallery-overview-snapshot';
import type { APIRoute } from 'astro';

export const prerender = false;
export const GET: APIRoute = async ({ url }) => {
  const cursor = url.searchParams.get('offset') ?? '0';
  if (cursor !== 'all' && !/^\d{1,7}$/.test(cursor)) return new Response(null, { status: 400 });
  const { payload } = await getOverviewSnapshot();
  return Response.json(
    overviewPage(payload, cursor === 'all' ? 'all' : Number(cursor), url.searchParams.get('revision') ?? undefined),
    { headers: { 'Cache-Control': 'no-store' } },
  );
};
