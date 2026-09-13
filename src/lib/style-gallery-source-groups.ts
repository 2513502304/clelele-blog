import type { StyleGalleryExampleOverviewItem } from '@/types/style-gallery';

/** The short source identity matches preview/detail labels and never includes the redundant title prefix. */
export function getStyleGallerySourceHash(source: { sourceSlug: string; sourceTitle: string }): string {
  return source.sourceSlug.match(/([a-f0-9]{12})$/i)?.[1] ?? source.sourceTitle.replace(/^Style Prompt\s+/i, '');
}

export interface StyleGallerySourceCard {
  example: StyleGalleryExampleOverviewItem;
  /** Only collapsed groups carry their members. Expanded cards remain individual images. */
  stack?: StyleGalleryExampleOverviewItem[];
}

/** Collapse only the filtered results, retaining the first occurrence and each group's internal sort order. */
export function getStyleGallerySourceCards(
  examples: StyleGalleryExampleOverviewItem[],
  isCollapsed: (slug: string) => boolean,
): StyleGallerySourceCard[] {
  const groups = new Map<string, StyleGallerySourceCard>();
  const cards: StyleGallerySourceCard[] = [];
  for (const example of examples) {
    if (!isCollapsed(example.sourceSlug)) {
      cards.push({ example });
      continue;
    }
    const existing = groups.get(example.sourceSlug);
    if (existing) existing.stack?.push(example);
    else {
      const card = { example, stack: [example] };
      groups.set(example.sourceSlug, card);
      cards.push(card);
    }
  }
  return cards;
}
