import { load } from 'cheerio';
import { readBoundedBody } from '../read-bounded-body';
import { HPOI_ORIGIN } from './constants';
import {
  isHpoiCollectionFragment,
  isHpoiCollectionPage,
  isHpoiDetailPage,
  parseHpoiCollection,
  parseHpoiCollectionPageCount,
} from './parser';
import type { HpoiPurchaseSource } from './purchases-job';
import { parseHpoiPurchase } from './purchases-parser';
import { hpoiRecordId } from './purchases-schema';

/** Only the logged-in personal menu proves whose session is being used; public profile content does not. */
export function assertHpoiPurchaseOwner(html: string, expectedUserId: string) {
  const $ = load(html);
  const profiles = new Set<string>();
  const collections = new Set<string>();
  $('ul.hpoi-navpersonal a[href]').each((_, link) => {
    const url = new URL($(link).attr('href') ?? '', HPOI_ORIGIN);
    if (url.origin !== HPOI_ORIGIN) return;
    const profile = url.pathname.match(/^\/user\/([1-9]\d*)\/?$/);
    const collection = url.pathname.match(/^\/user\/([1-9]\d*)\/hobby\/?$/);
    if (profile) profiles.add(profile[1]);
    if (collection && $(link).text().replace(/\s/g, '') === '我的收藏') collections.add(collection[1]);
  });
  if (profiles.size !== 1 || collections.size !== 1 || !profiles.has(expectedUserId) || !collections.has(expectedUserId))
    throw new Error('Hpoi session does not match the configured owner.');
}

/** Discover the internal ID from real item links. It is never derived from the public figure ID. */
export function parseHpoiPurchaseItemId(html: string, figureId: string) {
  if (!isHpoiDetailPage(html)) throw new Error('Unexpected Hpoi figure page.');
  const $ = load(html);
  const ids = new Set<string>();
  $('a[href]').each((_, link) => {
    const url = new URL($(link).attr('href') ?? '', HPOI_ORIGIN);
    if (url.origin !== HPOI_ORIGIN) return;
    if (
      (url.pathname === '/album/new' && url.searchParams.get('itemType') === 'hobby') ||
      url.pathname === '/modal/hobby/republic'
    ) {
      const parsed = hpoiRecordId.safeParse(url.searchParams.get('itemId'));
      if (parsed.success) ids.add(parsed.data);
    }
  });
  // The site's gallery loader supplies both namespaces; when present, require the public ID to match too.
  for (const script of $('script').toArray()) {
    const match = $(script)
      .text()
      .match(/fn\.init\(fn,\s*(\d+),\s*(\d+)/);
    if (match) {
      if (match[2] !== figureId) throw new Error('Hpoi public figure identity changed.');
      ids.add(hpoiRecordId.parse(match[1]));
    }
  }
  if (ids.size !== 1) throw new Error('Hpoi internal figure identity is missing or inconsistent.');
  return [...ids][0];
}

/** Fixed-origin, read-only owner access. Cookies are request-local and never enter durable business records. */
export function createHpoiPurchaseSource(sourceUserId: string, cookie: string): HpoiPurchaseSource {
  hpoiRecordId.parse(sourceUserId);
  if (!cookie.trim() || /[\r\n]/.test(cookie)) throw new Error('Hpoi owner session is not configured.');
  async function html(path: string, signal: AbortSignal, body?: URLSearchParams) {
    const url = new URL(path, HPOI_ORIGIN);
    if (url.origin !== HPOI_ORIGIN) throw new Error('Invalid Hpoi owner source.');
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      cache: 'no-store',
      body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      headers: { accept: 'text/html', cookie, referer: HPOI_ORIGIN, 'user-agent': 'Mozilla/5.0' },
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html'))
      throw new Error('Hpoi owner source unavailable.');
    const bytes = await readBoundedBody(response, 2_000_000);
    return new TextDecoder().decode(bytes);
  }
  return {
    async verifyOwner(signal) {
      assertHpoiPurchaseOwner(await html('/user/home', signal), sourceUserId);
    },
    async discover(page, knownPages, signal) {
      const path = `/user/${sourceUserId}/hobby`;
      const params = new URLSearchParams({ order: 'actionDate', view: '2', category: '-1', state: 'undefined', sortType: '0' });
      let response: string;
      if (page === 1) {
        response = await html(`${path}?${params}`, signal);
        assertHpoiPurchaseOwner(response, sourceUserId);
        if (!isHpoiCollectionPage(response)) throw new Error('Unexpected Hpoi owner collection.');
      } else {
        if (knownPages === null || page > knownPages || page > 100) throw new Error('Invalid Hpoi owner pagination.');
        params.set('page', String(page));
        params.set('pageCount', String(knownPages));
        params.set('tag', '');
        params.set('part', 'true');
        response = await html(path, signal, params);
        if (!isHpoiCollectionFragment(response)) throw new Error('Unexpected Hpoi owner collection fragment.');
      }
      const pages = page === 1 ? parseHpoiCollectionPageCount(response) : knownPages;
      if (pages === null || pages > 100) throw new Error('Hpoi owner pagination is missing or exceeds the limit.');
      const references = parseHpoiCollection(response).map(({ id, title }) => ({ figureId: id, title }));
      if ((pages === 0) !== (references.length === 0)) throw new Error('Hpoi owner collection pagination is inconsistent.');
      return { pages, references };
    },
    async read(reference, signal) {
      const detail = await html(`/hobby/${hpoiRecordId.parse(reference.figureId)}`, signal);
      assertHpoiPurchaseOwner(detail, sourceUserId);
      const itemId = parseHpoiPurchaseItemId(detail, reference.figureId);
      if (reference.itemId && reference.itemId !== itemId) throw new Error('Hpoi internal figure identity changed.');
      // Although Hpoi uses POST, this exact endpoint only returns the existing edit form. Never submit /add.
      const form = await html(`/collect/hobby/get/${itemId}`, signal, new URLSearchParams());
      return parseHpoiPurchase(form, { ...reference, itemId });
    },
  };
}
