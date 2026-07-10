import type { HpoiCollectionState } from '@/types/hpoi';

export const HPOI_ORIGIN = 'https://www.hpoi.net';

interface HpoiCollectionFilter {
  order: 'rating' | 'release';
  view: '1' | '2';
  favState?: Exclude<HpoiCollectionState, 'all'>;
}

export const HPOI_COLLECTION_FILTERS: Record<HpoiCollectionState, HpoiCollectionFilter> = {
  all: { order: 'rating', view: '1' },
  care: { order: 'rating', view: '1', favState: 'care' },
  want: { order: 'rating', view: '1', favState: 'want' },
  preorder: { order: 'release', view: '1', favState: 'preorder' },
  buy: { order: 'rating', view: '2', favState: 'buy' },
  resell: { order: 'rating', view: '2', favState: 'resell' },
};

export function createHpoiProfileUrl(userId: string): string {
  return `${HPOI_ORIGIN}/user/${encodeURIComponent(userId)}`;
}

export function createHpoiCollectionUrl(userId: string, state: HpoiCollectionState): string {
  const filter = HPOI_COLLECTION_FILTERS[state];
  const url = new URL(`/user/${encodeURIComponent(userId)}/hobby`, HPOI_ORIGIN);
  url.searchParams.set('order', filter.order);
  if (filter.favState) url.searchParams.set('favState', filter.favState);
  url.searchParams.set('view', filter.view);
  url.searchParams.set('state', 'undefined');
  url.searchParams.set('category', '-1');
  url.searchParams.set('sortType', '0');
  return url.toString();
}
