import type { HpoiCollectionItem, HpoiCollectionState } from '@/types/hpoi';

export const releaseStates = ['preorder', 'buy', 'resell', 'want', 'care'] as const;
export const stateColor: Record<HpoiCollectionState, string> = {
  preorder: '#ce6b16',
  buy: '#16836a',
  resell: '#8660b8',
  want: '#bc4b83',
  care: '#357ab3',
  all: 'transparent',
};

/** Cached older snapshots may only have the original month text. A month never implies a specific day. */
export function releasePeriod(item: Pick<HpoiCollectionItem, 'releaseDate' | 'releaseText'>) {
  const exact = item.releaseDate?.match(/^(\d{4}-\d{2})-(\d{2})$/);
  if (exact) return { month: exact[1], day: Number(exact[2]) };
  const month = item.releaseText?.match(/(\d{4})\s*年\s*(1[0-2]|0?[1-9])\s*月/);
  return { month: month ? `${month[1]}-${month[2].padStart(2, '0')}` : '', day: 0 };
}
