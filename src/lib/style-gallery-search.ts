import type { StyleGalleryData } from './style-gallery';
import { createStyleGalleryDateRangeMatcher } from './style-gallery-date-range';
import type { StyleGallerySortKey } from './style-gallery-sort';

/** Cache only offsets into the shared catalog. Never retain a copy of prompt text or cards per search. */
export function createGallerySearch(gallery: StyleGalleryData, prompts: Record<string, string>) {
  const headers = gallery.items.map((item) => `${item.title} ${item.imageHash} ${item.slug}`.toLowerCase());
  const recent = new Map<string, number[]>();
  return (q: string, from: string, to: string, sort: StyleGallerySortKey, descending: boolean) => {
    const key = JSON.stringify([q, from, to, sort, descending]);
    const cached = recent.get(key);
    if (cached) return cached;
    const inRange = createStyleGalleryDateRangeMatcher({ from, to });
    const hits: number[] = [];
    gallery.items.forEach((item, i) => {
      if ((headers[i].includes(q) || prompts[item.slug]?.includes(q)) && inRange(item.date)) hits.push(i);
    });
    if (sort !== 'default')
      hits.sort((i, j) => {
        const a = gallery.items[i],
          b = gallery.items[j];
        if (sort === 'id') return a.imageHash.localeCompare(b.imageHash);
        if (sort === 'examples') return a.exampleCount - b.exampleCount || a.date.localeCompare(b.date);
        if (sort === 'likes')
          return (
            (gallery.parentLikeCounts[a.slug] ?? 0) - (gallery.parentLikeCounts[b.slug] ?? 0) || a.date.localeCompare(b.date)
          );
        return a.date.localeCompare(b.date);
      });
    if (descending) hits.reverse();
    const oldest = recent.keys().next().value;
    if (recent.size >= 32 && oldest !== undefined) recent.delete(oldest);
    recent.set(key, hits);
    return hits;
  };
}
