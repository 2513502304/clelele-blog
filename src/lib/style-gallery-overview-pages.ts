import { createHash } from 'node:crypto';
import { getStyleGalleryDateKey } from './style-gallery-date-range';
import type { OverviewPage, OverviewPayload } from './style-gallery-overview-payload';

const pageSize = 24;
const directories = new WeakMap<OverviewPayload, ReturnType<typeof describe>>();
function describe(payload: OverviewPayload) {
  // Sources are interned in first-appearance order. Include every member of each requested stack.
  const dates = new Set<string>();
  for (const card of payload.cards) {
    const date = getStyleGalleryDateKey(card[4]);
    if (date) dates.add(date);
  }
  return {
    revision: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    dates: [...dates],
    slugs: payload.sources.map((s) => s.sourceSlug),
  };
}

/** A page is a window into one public revision. Cursor invalidation replaces the list as a whole. */
export function overviewPage(payload: OverviewPayload, offset: number | 'all', expected?: string): OverviewPage {
  let directory = directories.get(payload);
  if (!directory) {
    directory = describe(payload);
    directories.set(payload, directory);
  }
  const { revision, dates, slugs } = directory;
  const total = payload.cards.length;
  if (offset === 'all' || (expected && expected !== revision) || payload.sources.length <= pageSize) {
    return { revision, total, dates, slugs, full: true, next: null, payload };
  }
  const end = Math.min(offset + pageSize, payload.sources.length);
  return {
    revision,
    total,
    dates,
    slugs,
    full: false,
    next: end < payload.sources.length ? end : null,
    payload: {
      sources: payload.sources.slice(offset, end),
      cards: payload.cards
        .filter((row) => row[0] >= offset && row[0] < end)
        .map(([source, ...rest]) => [source - offset, ...rest]),
    },
  };
}
