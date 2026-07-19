import type { HpoiCollectionItem, HpoiSortDirection, HpoiSortKey } from '@/types/hpoi';

type Comparable = number | string | null;

function comparePresentValues(a: Comparable, b: Comparable, direction: HpoiSortDirection): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  const result =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), 'zh-CN', { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? result : -result;
}

function getSortValue(item: HpoiCollectionItem, key: Exclude<HpoiSortKey, 'default'>): Comparable {
  switch (key) {
    case 'id':
      return Number(item.id);
    case 'title':
      return item.title;
    case 'score': {
      const score = Number.parseFloat(item.score ?? '');
      return Number.isNaN(score) ? null : score;
    }
    case 'releaseDate':
      return item.releaseDate;
  }
}

/**
 * 返回排序后的副本，不修改抓取结果。
 *
 * `default` 的升序保持 Hpoi 页面顺序、降序反转页面顺序；缺少评分或出荷日期的条目始终排在末尾。
 */
export function sortHpoiCollectionItems(
  items: HpoiCollectionItem[],
  key: HpoiSortKey,
  direction: HpoiSortDirection,
): HpoiCollectionItem[] {
  if (key === 'default') return direction === 'asc' ? [...items] : [...items].reverse();

  return [...items].sort((a, b) => comparePresentValues(getSortValue(a, key), getSortValue(b, key), direction));
}
