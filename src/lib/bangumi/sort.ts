import type { BangumiSortDirection, BangumiSortKey, BangumiUserCollection } from '@/types/bangumi';

type Comparable = number | string | null;

function comparePresentValues(a: Comparable, b: Comparable, direction: BangumiSortDirection): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  const result =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), 'zh-CN', { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? result : -result;
}

function getSortValue(item: BangumiUserCollection, key: Exclude<BangumiSortKey, 'default'>): Comparable {
  switch (key) {
    case 'title':
      return item.subject.name_cn || item.subject.name;
    case 'personalScore':
      return item.rate > 0 ? item.rate : null;
    case 'averageScore':
      return item.subject.score > 0 ? item.subject.score : null;
    case 'date':
      return item.subject.date || null;
  }
}

/**
 * 返回排序后的副本，不修改 Bangumi API 返回的原数组。
 *
 * `default` 的升序保留接口顺序、降序反转接口顺序；其他字段无值的条目无论方向都放在末尾，
 * 避免切换升降序时空值突然占据列表开头。
 */
export function sortBangumiCollectionItems(
  items: BangumiUserCollection[],
  key: BangumiSortKey,
  direction: BangumiSortDirection,
): BangumiUserCollection[] {
  if (key === 'default') return direction === 'asc' ? [...items] : [...items].reverse();

  return [...items].sort((a, b) => comparePresentValues(getSortValue(a, key), getSortValue(b, key), direction));
}
