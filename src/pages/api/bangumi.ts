import type { APIRoute } from 'astro';
import { bangumiConfig } from '@/constants/site-config';
import { fetchUserCollections } from '@/lib/bangumi/api';
import { SUBJECT_TYPE_MAP, type SubjectTypeKey } from '@/lib/bangumi/constants';

export const prerender = false;
/** Cache each public page independently; loading anime must not fetch books/music/games. */
export const GET: APIRoute = async ({ url }) => {
  if (!bangumiConfig) return new Response('Not found', { status: 404 });
  const subject = url.searchParams.get('subject') ?? 'anime';
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Object.hasOwn(SUBJECT_TYPE_MAP, subject) || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000)
    return new Response('Invalid page', { status: 400 });
  try {
    const page = await fetchUserCollections(bangumiConfig.userId, SUBJECT_TYPE_MAP[subject as SubjectTypeKey], 24, offset);
    const end = offset + page.data.length;
    if (end < page.total && (page.data.length === 0 || end > 10000)) throw new Error('Incomplete upstream page');
    return Response.json(
      { items: page.data, total: page.total, next: end < page.total ? `/api/bangumi?subject=${subject}&offset=${end}` : null },
      { headers: { 'cache-control': 'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400' } },
    );
  } catch {
    return Response.json({ error: 'Bangumi unavailable' }, { status: 502 });
  }
};
