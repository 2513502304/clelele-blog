import { invalidateByTag } from '@vercel/functions';
import { z } from 'zod';
import { getStyleGalleryObjectTextSnapshot, putStyleGalleryObject, StyleGalleryObjectConflictError } from './hf-s3-presign';
import { getStyleGalleryCatalog } from './style-gallery-store';
import {
  applyGalleryTagMutation,
  getGalleryTagVocabulary,
  isValidGalleryTag,
  MAX_GALLERY_TAG_VOCABULARY,
  MAX_GALLERY_TAGS_PER_ITEM,
  normalizeGalleryTag,
  type StyleGalleryTagIndex,
} from './style-gallery-tags';

export const STYLE_GALLERY_TAG_KEY = 'metadata/tags-v1.json';
export const STYLE_GALLERY_TAG_CACHE_TAG = 'style-gallery-tags';
const tagSchema = z
  .string()
  .max(100)
  .transform(normalizeGalleryTag)
  .refine(isValidGalleryTag, 'Tags must contain 1–24 visible characters, without # or markup; null is reserved.');
const tagsSchema = z
  .array(tagSchema)
  .max(MAX_GALLERY_TAGS_PER_ITEM)
  .transform((tags) => [...new Set(tags)].sort());
const singleTagMutationSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,160}$/i),
  tags: tagsSchema,
  previousTags: tagsSchema,
});
/** Every bulk mode is atomic; replacement additionally compares each source's editing snapshot. */
export const galleryTagMutationSchema = z.union([
  singleTagMutationSchema,
  z
    .object({
      slugs: z
        .array(z.string().regex(/^[a-z0-9-]{1,160}$/i))
        .min(1)
        .max(10000)
        .transform((slugs) => [...new Set(slugs)]),
      mode: z.enum(['add', 'remove', 'replace']).optional(),
      // Removal can target the vocabulary across many sources, not just one source's 12 tags.
      tags: z
        .array(tagSchema)
        .max(MAX_GALLERY_TAG_VOCABULARY)
        .transform((tags) => [...new Set(tags)].sort()),
      previousTagsBySlug: z.record(z.string().regex(/^[a-z0-9-]{1,160}$/i), tagsSchema).optional(),
    })
    .superRefine((input, ctx) => {
      const mode = input.mode ?? 'add';
      if (mode !== 'replace' && !input.tags.length)
        ctx.addIssue({ code: 'custom', path: ['tags'], message: 'Choose at least one tag.' });
      if (mode !== 'remove' && input.tags.length > MAX_GALLERY_TAGS_PER_ITEM)
        ctx.addIssue({ code: 'custom', path: ['tags'], message: 'At most 12 tags are allowed.' });
      if (mode === 'replace' && input.slugs.some((slug) => !Object.hasOwn(input.previousTagsBySlug ?? {}, slug)))
        ctx.addIssue({
          code: 'custom',
          path: ['previousTagsBySlug'],
          message: 'Replacement requires a base for every source.',
        });
    }),
]);
const indexSchema = z.object({ version: z.literal(1), items: z.record(z.string().regex(/^[a-z0-9-]{1,160}$/i), tagsSchema) });

export class GalleryTagWriteError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** CDN misses read storage directly so another worker cannot republish a stale process snapshot. */
export async function getGalleryTagIndex(): Promise<StyleGalleryTagIndex> {
  const snapshot = await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_TAG_KEY);
  const value = snapshot.text ? indexSchema.parse(JSON.parse(snapshot.text)) : { version: 1 as const, items: {} };
  return value;
}

/** Compare the edited source's base tags while replaying unrelated concurrent writes via ETag. */
export async function setGalleryTags(input: z.infer<typeof galleryTagMutationSchema>): Promise<StyleGalleryTagIndex> {
  const mutation = galleryTagMutationSchema.parse(input);
  const slugs = 'slugs' in mutation ? mutation.slugs : [mutation.slug];
  const { tags } = mutation;
  const catalog = await getStyleGalleryCatalog();
  const known = new Set(catalog.items.map((item) => item.slug));
  if (slugs.some((slug) => !known.has(slug))) throw new GalleryTagWriteError('Style not found.', 404);
  for (let attempt = 0; attempt < 6; attempt++) {
    const snapshot = await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_TAG_KEY);
    if (snapshot.text && !snapshot.etag) throw new Error('Tag index ETag is missing.');
    const current = snapshot.text
      ? indexSchema.parse(JSON.parse(snapshot.text))
      : { version: 1 as const, items: {} as Record<string, string[]> };
    const next: StyleGalleryTagIndex = { version: 1, items: { ...current.items } };
    let changed = false;
    for (const slug of slugs) {
      const existing = current.items[slug] ?? [];
      const updated = 'slugs' in mutation ? applyGalleryTagMutation(existing, tags, mutation.mode ?? 'add') : tags;
      if (JSON.stringify(existing) === JSON.stringify(updated)) continue;
      const previous =
        'slugs' in mutation
          ? mutation.mode === 'replace'
            ? mutation.previousTagsBySlug?.[slug]
            : undefined
          : mutation.previousTags;
      if (previous && JSON.stringify(existing) !== JSON.stringify(previous))
        throw new GalleryTagWriteError('Tags changed in another session. Reopen the editor before saving.', 409);
      if (updated.length > MAX_GALLERY_TAGS_PER_ITEM)
        throw new GalleryTagWriteError(`Adding these tags would exceed 12 tags for ${slug}. No changes were saved.`, 400);
      if (updated.length) next.items[slug] = updated;
      else delete next.items[slug];
      changed = true;
    }
    if (!changed) return current;
    if (getGalleryTagVocabulary(next).length > MAX_GALLERY_TAG_VOCABULARY)
      throw new GalleryTagWriteError('The gallery supports up to 100 categories. Reuse an existing tag.', 400);
    try {
      await putStyleGalleryObject(
        STYLE_GALLERY_TAG_KEY,
        new TextEncoder().encode(JSON.stringify(next)),
        'application/json; charset=utf-8',
        snapshot.etag ? { ifMatch: snapshot.etag } : { ifNoneMatch: '*' },
      );
      // Tags are client-loaded; invalidating list/item SSR would only recreate unchanged payloads.
      try {
        await invalidateByTag(STYLE_GALLERY_TAG_CACHE_TAG);
      } catch (error) {
        console.error('[style-gallery] Tags were saved but tag-cache invalidation failed.', error);
      }
      return next;
    } catch (error) {
      if (!(error instanceof StyleGalleryObjectConflictError) || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
  throw new Error('Tag update exhausted retries.');
}
