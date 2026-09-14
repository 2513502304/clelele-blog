/** Shared category labels belong to a source slug, never to individual generated images. */
export interface StyleGalleryTagIndex {
  version: 1;
  items: Record<string, string[]>;
}

export const MAX_GALLERY_TAGS_PER_ITEM = 12;
export const MAX_GALLERY_TAG_LENGTH = 24;
export const MAX_GALLERY_TAG_VOCABULARY = 100;

/** Normalize pasted hashtags, full-width characters and Latin case into one category identity. */
export function normalizeGalleryTag(value: string): string {
  return value.normalize('NFKC').trim().replace(/^#+/, '').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function galleryTagMatches(tags: readonly string[], query: string): boolean {
  const q = normalizeGalleryTag(query);
  return Boolean(q) && tags.some((tag) => tag.includes(q));
}

/** Suggestions include the entire small vocabulary when empty, with usage counts for discovery. */
export function getGalleryTagVocabulary(index: StyleGalleryTagIndex): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const tags of Object.values(index.items)) {
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
