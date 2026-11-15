import type { HpoiCollectionItem, HpoiProfile } from '@/types/hpoi';

export interface HpoiSnapshot {
  items: HpoiCollectionItem[];
  meta?: { profile?: HpoiProfile; warnings: string[]; fetchedAt: string };
  complete: boolean;
  savedAt: number;
  loading: boolean;
  error: boolean;
}

/** Preserve unchanged objects (and card DOM) while honoring the authoritative order and deletions.
 * Call only after the last page succeeds: a partial crawl cannot prove an item was removed.
 */
export function reconcileHpoiItems(previous: HpoiCollectionItem[], incoming: HpoiCollectionItem[]) {
  const byId = new Map(previous.map((item) => [item.id, item]));
  return [...new Map(incoming.map((item) => [item.id, item])).values()].map((item) => {
    const old = byId.get(item.id);
    return old && JSON.stringify(old) === JSON.stringify(item) ? old : item;
  });
}
