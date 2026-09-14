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

/** Shared by the HTTP editor and JSONL importer after normalization. */
export function isValidGalleryTag(tag: string): boolean {
  return (
    tag !== 'null' &&
    Array.from(tag).length > 0 &&
    Array.from(tag).length <= MAX_GALLERY_TAG_LENGTH &&
    !/[\p{Cc}\p{Cf}<>#]/u.test(tag)
  );
}

/** Hashtags are exact, AND-combined categories; #null is reserved for sources with no tags.
 * Split before each hashtag so existing category names containing spaces remain searchable.
 */
export function galleryTagMatches(tags: readonly string[], query: string): boolean {
  const terms = query
    .normalize('NFKC')
    .trim()
    .split(/\s+(?=#)/u)
    .map(normalizeGalleryTag);
  return terms.every((term) => Boolean(term) && (term === 'null' ? tags.length === 0 : tags.includes(term)));
}

/** Suggestions include the entire small vocabulary when empty, with usage counts for discovery. */
export function getGalleryTagVocabulary(index: StyleGalleryTagIndex): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const tags of Object.values(index.items)) {
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
