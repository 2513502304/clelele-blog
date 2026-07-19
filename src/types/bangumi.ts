// Bangumi API v0 类型定义：https://bangumi.github.io/api/

/** Bangumi 条目类型：1=书籍、2=动画、3=音乐、4=游戏、6=三次元。 */
export type BangumiSubjectType = 1 | 2 | 3 | 4 | 6;

/** 用户收藏状态：1=想看、2=看过、3=在看、4=搁置、5=抛弃。 */
export type BangumiCollectionType = 1 | 2 | 3 | 4 | 5;

/** 追番页允许的本地排序字段；`default` 表示保留 Bangumi 接口顺序。 */
export const BANGUMI_SORT_KEYS = ['default', 'title', 'personalScore', 'averageScore', 'date'] as const;

export type BangumiSortKey = (typeof BANGUMI_SORT_KEYS)[number];
export type BangumiSortDirection = 'asc' | 'desc';

export interface BangumiSubjectImages {
  large: string;
  common: string;
  medium: string;
  small: string;
  grid: string;
}

export interface BangumiSubjectTag {
  name: string;
  count: number;
}

export interface BangumiSlimSubject {
  id: number;
  type: BangumiSubjectType;
  name: string;
  name_cn: string;
  date?: string | null;
  images?: BangumiSubjectImages | null;
  score: number;
  tags?: BangumiSubjectTag[];
  /** 动画集数；部分条目类型不会返回。 */
  eps?: number;
  /** 书籍卷数；部分条目类型不会返回。 */
  volumes?: number;
  /** Bangumi 全站收藏人数。 */
  collection_total?: number;
  /** Bangumi 全站排名，未进入排名时可能缺失。 */
  rank?: number;
}

export interface BangumiUserCollection {
  subject_id: number;
  subject_type: BangumiSubjectType;
  rate: number;
  type: BangumiCollectionType;
  tags: string[];
  ep_status: number;
  vol_status: number;
  updated_at: string;
  subject: BangumiSlimSubject;
}

export interface BangumiCollectionResponse {
  data: BangumiUserCollection[];
  total: number;
  limit: number;
  offset: number;
}
