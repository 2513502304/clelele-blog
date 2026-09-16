import type { StoredStyleGalleryItem } from '@/types/style-gallery';

export type GalleryMergeSide = 0 | 1;

/** Only identities and selections cross the write boundary; clients cannot submit replacement metadata. */
export interface GalleryMergeSelection {
  keep: GalleryMergeSide;
  date: GalleryMergeSide;
  prompts: { side: GalleryMergeSide; id: string }[];
  original: { side: GalleryMergeSide; id: string } | null;
  examples: GalleryMergeSide[];
  tags: string[];
}

export interface GalleryMergeCard {
  item: StoredStyleGalleryItem;
  revision: string;
  tags: string[];
  likeCounts: Record<string, number>;
}

export interface GalleryMergePreview {
  cards: [GalleryMergeCard, GalleryMergeCard];
}
