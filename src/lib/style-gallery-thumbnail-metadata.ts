import { getStyleGallerySourceThumbnail } from './style-gallery-image-key';

/** Refuse non-derivable overrides instead of silently losing an existing custom preview. */
export function stripStyleGalleryThumbnailMetadata(value: unknown): { value: unknown; removed: number } {
  if (Array.isArray(value)) {
    const results = value.map(stripStyleGalleryThumbnailMetadata);
    return { value: results.map((result) => result.value), removed: results.reduce((sum, result) => sum + result.removed, 0) };
  }
  if (!value || typeof value !== 'object') return { value, removed: 0 };
  const record = value as Record<string, unknown>;
  let removed = 0;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key === 'thumbnailImage') {
      if (typeof record.sourceImage !== 'string' || entry !== getStyleGallerySourceThumbnail(record.sourceImage)) {
        throw new Error('Thumbnail override cannot be derived from its reference source.');
      }
      removed++;
    } else {
      const result = stripStyleGalleryThumbnailMetadata(entry);
      next[key] = result.value;
      removed += result.removed;
    }
  }
  return { value: next, removed };
}
