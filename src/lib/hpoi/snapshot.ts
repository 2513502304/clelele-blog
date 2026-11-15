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
 * A partial crawl must merge previously seen IDs into incoming first: only the
 * confirmed last page permits omissions to be treated as deletions.
 */
export function reconcileHpoiItems(previous: HpoiCollectionItem[], incoming: HpoiCollectionItem[]) {
  const byId = new Map(previous.map((item) => [item.id, item]));
  return [...new Map(incoming.map((item) => [item.id, item])).values()].map((item) => {
    const old = byId.get(item.id);
    return old && JSON.stringify(old) === JSON.stringify(item) ? old : item;
  });
}
