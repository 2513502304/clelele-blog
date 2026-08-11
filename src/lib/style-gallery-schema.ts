import { z } from 'zod';
import type { StoredStyleGalleryItem, StyleGalleryCatalogItem } from '@/types/style-gallery';
import { getPrimaryStyleGalleryPrompt, getStyleGalleryPromptId, normalizeStyleGalleryPrompt } from './style-gallery-prompts';

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

export const styleGalleryPromptVariantSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/i),
  prompt: z.string().trim().min(1),
  model: z.string().trim().min(1).optional(),
  originalPrompt: z.string().optional(),
  importedAt: z.string().datetime({ offset: true }),
  sourceSession: z.string().optional(),
  sourceLine: z.number().int().positive().optional(),
});

const styleGalleryItemFields = {
  slug: z.string().regex(/^[a-z0-9-]+$/i),
  title: z.string().min(1),
  date: z.string().datetime({ offset: true }),
  updated: z.string().datetime({ offset: true }).optional(),
  sourceImage: imagePathSchema,
  thumbnailImage: imagePathSchema.optional(),
  sourceImageAlt: z.string().min(1).optional(),
  imageHash: imageHashSchema,
  images: z.array(styleGalleryImageSchema).min(1),
  draft: z.boolean().optional(),
  examples: z.array(styleGalleryExampleSchema).default([]),
};

const currentStyleGalleryItemSchema = z
  .object({
    version: z.literal(4).default(4),
    ...styleGalleryItemFields,
    prompts: z.array(styleGalleryPromptVariantSchema).min(1),
  })
  .superRefine((item, context) => {
    const seen = new Set<string>();
    item.prompts.forEach((variant, index) => {
      const normalized = normalizeStyleGalleryPrompt(variant.prompt);
      if (variant.id !== getStyleGalleryPromptId(normalized)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Prompt ID does not match prompt text.',
          path: ['prompts', index, 'id'],
        });
      }
      if (seen.has(normalized)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate prompt text in style gallery item.',
          path: ['prompts', index, 'prompt'],
        });
      }
      seen.add(normalized);
    });
  });

const legacyStyleGalleryItemSchema = z
  .object({
    version: z.literal(3),
    ...styleGalleryItemFields,
    prompt: z.string().trim().min(1),
    originalPrompt: z.string().optional(),
    sourceSession: z.string().optional(),
    sourceLine: z.number().int().positive().optional(),
  })
  .transform(
    ({ prompt, originalPrompt, sourceSession, sourceLine, ...item }): StoredStyleGalleryItem => ({
      ...item,
      version: 4,
      prompts: [
        {
          id: getStyleGalleryPromptId(prompt),
          prompt,
          ...(originalPrompt ? { originalPrompt } : {}),
          importedAt: item.date,
          ...(sourceSession ? { sourceSession } : {}),
          ...(sourceLine ? { sourceLine } : {}),
        },
      ],
    }),
  );

/** 读取时兼容既有 v3 对象；下一次写入该 item 时会自然收敛为 v4。 */
export const styleGalleryItemSchema = z.union([currentStyleGalleryItemSchema, legacyStyleGalleryItemSchema]);

export const styleGalleryCatalogItemSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]+$/i),
    title: z.string().min(1),
    date: z.string().datetime({ offset: true }),
    sourceImage: imagePathSchema,
    thumbnailImage: imagePathSchema.optional(),
    sourceImageAlt: z.string().min(1).optional(),
    prompt: z.string().min(1),
    additionalPrompts: z.array(z.string().trim().min(1)).default([]),
    promptCount: z.number().int().positive().default(1),
    imageHash: imageHashSchema,
    imageCount: z.number().int().positive(),
    exampleCount: z.number().int().nonnegative(),
  })
  .superRefine((item, context) => {
    const prompts = [item.prompt, ...item.additionalPrompts].map(normalizeStyleGalleryPrompt);
    if (item.promptCount !== prompts.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Prompt count does not match catalog prompt entries.',
        path: ['promptCount'],
      });
    }
    if (new Set(prompts).size !== prompts.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicate prompt text in style gallery catalog item.',
        path: ['additionalPrompts'],
      });
    }
  });

const styleGalleryCatalogFields = {
  updatedAt: z.string().datetime({ offset: true }),
  tags: z.array(z.string()),
  modelTargets: z.array(z.string()),
  items: z.array(styleGalleryCatalogItemSchema),
};

const currentStyleGalleryCatalogSchema = z.object({ version: z.literal(4), ...styleGalleryCatalogFields });
const legacyStyleGalleryCatalogSchema = z
  .object({ version: z.literal(3), ...styleGalleryCatalogFields })
  .transform(({ version: _version, ...catalog }) => ({ ...catalog, version: 4 as const }));

/** 迁移期间兼容 v3 catalog；所有写路径只会输出 v4。 */
export const styleGalleryCatalogSchema = z.union([currentStyleGalleryCatalogSchema, legacyStyleGalleryCatalogSchema]);

export const styleGalleryExampleIndexSchema = z.object({
  version: z.literal(2),
  updatedAt: z.string().datetime({ offset: true }),
  groups: z.array(
    z.object({
      sourceSlug: z.string().regex(/^[a-z0-9-]+$/i),
      examples: z.array(
        styleGalleryExampleSchema
          .pick({ id: true, src: true, model: true, note: true, uploadedAt: true })
          .extend({ likedBy: z.array(z.number().int().positive()).max(100_000) }),
      ),
    }),
  ),
});

/**
 * 从完整 item 派生列表索引条目。
 * 这里有意只保留 `exampleCount`，示例明细由详情 item 和独立示例索引负责。
 */
export function toStyleGalleryCatalogItem(
  item: StoredStyleGalleryItem,
  exampleCount = item.examples.length,
): StyleGalleryCatalogItem {
  const primaryPrompt = getPrimaryStyleGalleryPrompt(item.prompts);
  return {
    slug: item.slug,
    title: item.title,
    date: item.date,
    sourceImage: item.sourceImage,
    thumbnailImage: item.thumbnailImage,
    sourceImageAlt: item.sourceImageAlt,
    prompt: primaryPrompt.prompt,
    additionalPrompts: item.prompts.slice(1).map((variant) => variant.prompt),
    promptCount: item.prompts.length,
    imageHash: item.imageHash,
    imageCount: item.images.length,
    exampleCount,
  };
}
