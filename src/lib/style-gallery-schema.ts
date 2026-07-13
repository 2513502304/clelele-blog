import { z } from 'zod';
import type { StoredStyleGalleryItem, StyleGalleryCatalogItem } from '@/types/style-gallery';

const imagePathSchema = z.string().regex(/^\/api\/style-gallery\/image\/(source|thumb)\/[a-zA-Z0-9._-]+$/);
const imageHashSchema = z.string().regex(/^[a-f0-9]{64}$/i);

export const styleGalleryImageSchema = z.object({
  sourceImage: imagePathSchema,
  thumbnailImage: imagePathSchema.optional(),
  sourceImageAlt: z.string().min(1).optional(),
  imageHash: imageHashSchema,
});

export const styleGalleryExampleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/i),
  src: z.string().min(1),
  alt: z.string().min(1),
  model: z.string().min(1),
  note: z.string().optional(),
  uploadedAt: z.string().datetime({ offset: true }),
  imageHash: imageHashSchema,
});

export const styleGalleryItemSchema = z.object({
  version: z.literal(3).default(3),
  slug: z.string().regex(/^[a-z0-9-]+$/i),
  title: z.string().min(1),
  date: z.string().datetime({ offset: true }),
  updated: z.string().datetime({ offset: true }).optional(),
  sourceImage: imagePathSchema,
  thumbnailImage: imagePathSchema.optional(),
  sourceImageAlt: z.string().min(1).optional(),
  prompt: z.string().min(1),
  originalPrompt: z.string().optional(),
  imageHash: imageHashSchema,
  images: z.array(styleGalleryImageSchema).min(1),
  sourceSession: z.string().optional(),
  sourceLine: z.number().int().positive().optional(),
  draft: z.boolean().optional(),
  examples: z.array(styleGalleryExampleSchema).default([]),
});

export const styleGalleryCatalogItemSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/i),
  title: z.string().min(1),
  date: z.string().datetime({ offset: true }),
  sourceImage: imagePathSchema,
  thumbnailImage: imagePathSchema.optional(),
  sourceImageAlt: z.string().min(1).optional(),
  prompt: z.string().min(1),
  imageHash: imageHashSchema,
  imageCount: z.number().int().positive(),
  exampleCount: z.number().int().nonnegative(),
});

export const styleGalleryCatalogSchema = z.object({
  version: z.literal(3),
  updatedAt: z.string().datetime({ offset: true }),
  tags: z.array(z.string()),
  modelTargets: z.array(z.string()),
  items: z.array(styleGalleryCatalogItemSchema),
});

export const styleGalleryExampleIndexSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().datetime({ offset: true }),
  groups: z.array(
    z.object({
      sourceSlug: z.string().regex(/^[a-z0-9-]+$/i),
      examples: z.array(styleGalleryExampleSchema.pick({ id: true, src: true, model: true, note: true, uploadedAt: true })),
    }),
  ),
});

export function toStyleGalleryCatalogItem(
  item: StoredStyleGalleryItem,
  exampleCount = item.examples.length,
): StyleGalleryCatalogItem {
  return {
    slug: item.slug,
    title: item.title,
    date: item.date,
    sourceImage: item.sourceImage,
    thumbnailImage: item.thumbnailImage,
    sourceImageAlt: item.sourceImageAlt,
    prompt: item.prompt,
    imageHash: item.imageHash,
    imageCount: item.images.length,
    exampleCount,
  };
}
