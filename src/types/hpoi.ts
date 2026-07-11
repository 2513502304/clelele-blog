export const HPOI_COLLECTION_STATES = ['all', 'care', 'want', 'preorder', 'buy', 'resell'] as const;

export type HpoiCollectionState = (typeof HPOI_COLLECTION_STATES)[number];

export const HPOI_SORT_KEYS = ['default', 'id', 'title', 'score', 'releaseDate'] as const;

export type HpoiSortKey = (typeof HPOI_SORT_KEYS)[number];
export type HpoiSortDirection = 'asc' | 'desc';

export interface HpoiCollectionItem {
  id: string;
  title: string;
  imageUrl: string | null;
  detailUrl: string;
  releaseText: string | null;
  /** ISO date used for stable sorting; releaseText preserves Hpoi's display text. */
  releaseDate: string | null;
  score: string | null;
}

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

export interface HpoiCollectionResponse {
  profile: HpoiProfile;
  collections: Record<HpoiCollectionState, HpoiCollectionItem[]>;
  fetchedAt: string;
  warnings: Array<HpoiCollectionState | 'profile'>;
}
