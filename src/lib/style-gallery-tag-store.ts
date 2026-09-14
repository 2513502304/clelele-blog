import { z } from 'zod';
import { getStyleGalleryObjectTextSnapshot, putStyleGalleryObject, StyleGalleryObjectConflictError } from './hf-s3-presign';
import { invalidateStyleGalleryPublicCache } from './style-gallery-public-cache';
import { getStyleGalleryCatalog } from './style-gallery-store';
import {
  getGalleryTagVocabulary,
  MAX_GALLERY_TAG_LENGTH,
  MAX_GALLERY_TAG_VOCABULARY,
  MAX_GALLERY_TAGS_PER_ITEM,
  normalizeGalleryTag,
  type StyleGalleryTagIndex,
} from './style-gallery-tags';

export const STYLE_GALLERY_TAG_KEY = 'metadata/tags-v1.json';
const tagSchema = z
  .string()
  .max(100)
  .transform(normalizeGalleryTag)
  .refine(
    (tag) => Array.from(tag).length > 0 && Array.from(tag).length <= MAX_GALLERY_TAG_LENGTH && !/[\p{Cc}\p{Cf}<>#]/u.test(tag),
    'Tags must contain 1–24 visible characters, without # or markup.',
  );
const tagsSchema = z
  .array(tagSchema)
  .max(MAX_GALLERY_TAGS_PER_ITEM)
  .transform((tags) => [...new Set(tags)].sort());
export const galleryTagMutationSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,160}$/i),
  tags: tagsSchema,
  previousTags: tagsSchema,
});
const indexSchema = z.object({ version: z.literal(1), items: z.record(z.string().regex(/^[a-z0-9-]{1,160}$/i), tagsSchema) });
let cache: { value: StyleGalleryTagIndex; expiresAt: number } | undefined;

export class GalleryTagWriteError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** A sparse, independently cached index avoids enlarging every item or copying tags into examples. */
export async function getGalleryTagIndex(fresh = false): Promise<StyleGalleryTagIndex> {
  if (!fresh && cache && cache.expiresAt > Date.now()) return cache.value;
  const snapshot = await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_TAG_KEY);
  const value = snapshot.text ? indexSchema.parse(JSON.parse(snapshot.text)) : { version: 1 as const, items: {} };
  cache = { value, expiresAt: Date.now() + 30_000 };
  return value;
}

/** Compare the edited source's base tags while replaying unrelated concurrent writes via ETag. */
export async function setGalleryTags(input: z.infer<typeof galleryTagMutationSchema>): Promise<StyleGalleryTagIndex> {
  const { slug, tags, previousTags } = galleryTagMutationSchema.parse(input);
  const catalog = await getStyleGalleryCatalog();
  if (!catalog.items.some((item) => item.slug === slug)) throw new GalleryTagWriteError('Style not found.', 404);
  for (let attempt = 0; attempt < 6; attempt++) {
    const snapshot = await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_TAG_KEY);
    if (snapshot.text && !snapshot.etag) throw new Error('Tag index ETag is missing.');
    const current = snapshot.text
      ? indexSchema.parse(JSON.parse(snapshot.text))
      : { version: 1 as const, items: {} as Record<string, string[]> };
    const existing = current.items[slug] ?? [];
    if (JSON.stringify(existing) === JSON.stringify(tags)) return current;
    if (JSON.stringify(existing) !== JSON.stringify(previousTags))
      throw new GalleryTagWriteError('Tags changed in another session. Reopen the editor before saving.', 409);
    const next: StyleGalleryTagIndex = { version: 1, items: { ...current.items } };
    if (tags.length) next.items[slug] = tags;
    else delete next.items[slug];
    if (getGalleryTagVocabulary(next).length > MAX_GALLERY_TAG_VOCABULARY)
      throw new GalleryTagWriteError('The gallery supports up to 100 categories. Reuse an existing tag.', 400);
    try {
      await putStyleGalleryObject(
        STYLE_GALLERY_TAG_KEY,
        new TextEncoder().encode(JSON.stringify(next)),
        'application/json; charset=utf-8',
        snapshot.etag ? { ifMatch: snapshot.etag } : { ifNoneMatch: '*' },
      );
      cache = { value: next, expiresAt: Date.now() + 30_000 };
      await invalidateStyleGalleryPublicCache([slug]);
      return next;
    } catch (error) {
      if (!(error instanceof StyleGalleryObjectConflictError) || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
  throw new Error('Tag update exhausted retries.');
}
