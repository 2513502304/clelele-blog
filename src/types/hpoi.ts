/** 本站展示的 Hpoi 公开收藏入口，顺序同时决定页面标签顺序。 */
export const HPOI_COLLECTION_STATES = ['all', 'care', 'want', 'preorder', 'buy', 'resell'] as const;

export type HpoiCollectionState = (typeof HPOI_COLLECTION_STATES)[number];

/** `default` 表示保留 Hpoi 页面原始顺序。 */
export const HPOI_SORT_KEYS = ['default', 'id', 'title', 'score', 'releaseDate'] as const;

export type HpoiSortKey = (typeof HPOI_SORT_KEYS)[number];
export type HpoiSortDirection = 'asc' | 'desc';

/** 从 Hpoi 公开收藏列表可稳定提取的条目字段。 */
export interface HpoiCollectionItem {
  id: string;
  title: string;
  imageUrl: string | null;
  detailUrl: string;
  releaseText: string | null;
  /** 用于稳定排序的 ISO 日期；`releaseText` 保留 Hpoi 原始展示文案。 */
  releaseDate: string | null;
  score: string | null;
}

/** Hpoi 个人页公开展示的收藏与预定汇总值；缺失或解析失败的字段为 `null`。 */
export interface HpoiProfileStats {
  owned: string | null;
  totalSpent: string | null;
  amazonChange: string | null;
  wanted: string | null;
  preordered: string | null;
  pendingPayment: string | null;
}

export interface HpoiProfile {
  userId: string;
  name: string;
  avatarUrl: string | null;
  signature: string | null;
  profileUrl: string;
  stats: HpoiProfileStats;
}

/** API 返回给手办收藏页面的完整快照。 */
export interface HpoiCollectionResponse {
  profile: HpoiProfile;
  collections: Record<HpoiCollectionState, HpoiCollectionItem[]>;
  fetchedAt: string;
  /** 本次快照中抓取失败的局部数据源；未列出的收藏状态仍可正常使用。 */
  warnings: Array<HpoiCollectionState | 'profile'>;
}
