import { z } from 'zod';
import type { StoredStyleGalleryItem, StyleGalleryCatalogItem, StyleGalleryPromptSearchIndex } from '@/types/style-gallery';
import { STYLE_GALLERY_PLATFORMS, type StyleGalleryPlatformLabel } from './style-gallery-platforms';
import {
  getPrimaryStyleGalleryPrompt,
  getStyleGalleryPromptId,
  getStyleGalleryPromptRevision,
  normalizeStyleGalleryPrompt,
} from './style-gallery-prompts';
import {
  STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION,
  STYLE_GALLERY_VISUAL_INDEX_VERSION,
  STYLE_GALLERY_VISUAL_MODEL_ID,
} from './style-gallery-visual-types';

const imagePathSchema = z.string().regex(/^\/api\/style-gallery\/image\/(source|thumb)\/[a-zA-Z0-9._-]+$/);
const imageHashSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const promptRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/i);
export const styleGalleryImageDimensionsSchema = z.object({
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
});
const platformLabels = STYLE_GALLERY_PLATFORMS.map((platform) => platform.label) as [
  StyleGalleryPlatformLabel,
  ...StyleGalleryPlatformLabel[],
];
export const styleGalleryPlatformLabelSchema = z.enum(platformLabels);
const styleGalleryModelTargetsSchema = z.array(styleGalleryPlatformLabelSchema).superRefine((targets, context) => {
  const expected = STYLE_GALLERY_PLATFORMS.map((platform) => platform.label);
  if (targets.length !== expected.length || targets.some((target, index) => target !== expected[index])) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Model targets must match the canonical platform order.',
    });
  }
});

export const styleGalleryImageSchema = z.object({
  dimensions: styleGalleryImageDimensionsSchema.optional(),
  sourceImage: imagePathSchema,
  thumbnailImage: imagePathSchema.optional(),
  sourceImageAlt: z.string().min(1).optional(),
  imageHash: imageHashSchema,
});

export const styleGalleryExampleSchema = z.object({
  dimensions: styleGalleryImageDimensionsSchema.optional(),
  id: z.string().regex(/^[a-z0-9-]+$/i),
  src: z.string().min(1),
  alt: z.string().min(1),
  model: styleGalleryPlatformLabelSchema,
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

export const styleGalleryItemSchema = z
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

export const styleGalleryCatalogItemSchema = z.object({
  dimensions: styleGalleryImageDimensionsSchema.optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/i),
  title: z.string().min(1),
  date: z.string().datetime({ offset: true }),
  sourceImage: imagePathSchema,
  thumbnailImage: imagePathSchema.optional(),
  sourceImageAlt: z.string().min(1).optional(),
  promptExcerpt: z.string().trim().min(1).max(181),
  promptCount: z.number().int().positive().default(1),
  promptRevision: promptRevisionSchema,
  imageHash: imageHashSchema,
  imageCount: z.number().int().positive(),
  exampleCount: z.number().int().nonnegative(),
});

const styleGalleryCatalogFields = {
  updatedAt: z.string().datetime({ offset: true }),
  // 平台词表是共享配置；旧 catalog 的无效全局 tags 在解析时自动丢弃。
  modelTargets: styleGalleryModelTargetsSchema,
  items: z.array(styleGalleryCatalogItemSchema),
};

/** HF 已一次性迁移到 v5；旧版本必须明确失败，避免读写路径重新分叉并掩盖残留数据。 */
export const styleGalleryCatalogSchema = z.object({ version: z.literal(5), ...styleGalleryCatalogFields });

export const styleGalleryPromptSearchIndexSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().datetime({ offset: true }),
  entries: z.record(z.string().regex(/^[a-z0-9-]+$/i), z.array(z.string().trim().min(1)).min(1)),
});

export const styleGalleryExampleIndexSchema = z.object({
  version: z.literal(2),
  updatedAt: z.string().datetime({ offset: true }),
  groups: z.array(
    z.object({
      sourceSlug: z.string().regex(/^[a-z0-9-]+$/i),
      examples: z.array(
        styleGalleryExampleSchema
          .pick({ id: true, src: true, model: true, note: true, uploadedAt: true, dimensions: true })
          .extend({ likedBy: z.array(z.number().int().positive()).max(100_000) }),
      ),
    }),
  ),
});

export const styleGalleryVisualFeatureSchema = z.object({
  imageHash: imageHashSchema,
  perceptualHash: z.string().regex(/^[a-f0-9]{16}$/i),
  differenceHash: z.string().regex(/^[a-f0-9]{16}$/i),
  palette: z.string().regex(/^[A-Za-z0-9+/]{32}$/),
  embedding: z
    .string()
    .regex(/^[A-Za-z0-9+/]{512}$/)
    // 384 个零字节会编码为 512 个 A；它没有方向，余弦相似度分母为零，不能进入查询或持久化索引。
    .refine((value) => value !== 'A'.repeat(512), 'Visual embedding must contain a non-zero vector.'),
});

export const styleGalleryVisualRecordInputSchema = z.object({
  feature: styleGalleryVisualFeatureSchema,
  kind: z.enum(['source', 'example']),
  sourceSlug: z.string().regex(/^[a-z0-9-]+$/i),
  imageId: z.string().min(1),
});

/**
 * 视觉索引是可由图片对象和现有 metadata 全量重建的派生数据，不参与 Gallery 正常读取路径。
 * schema 刻意只接受当前模型与版本，迁移完成后若模型变化必须整体重建，不能静默混用向量空间。
 */
export const styleGalleryVisualIndexSchema = z
  .object({
    version: z.literal(STYLE_GALLERY_VISUAL_INDEX_VERSION),
    updatedAt: z.string().datetime({ offset: true }),
    model: z.object({
      id: z.literal(STYLE_GALLERY_VISUAL_MODEL_ID),
      dimensions: z.literal(STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION),
      quantization: z.literal('int8-unit'),
    }),
    features: z.array(styleGalleryVisualFeatureSchema),
    records: z.array(
      z.object({
        featureIndex: z.number().int().nonnegative(),
        kind: z.enum(['source', 'example']),
        sourceSlug: z.string().regex(/^[a-z0-9-]+$/i),
        imageId: z.string().min(1),
      }),
    ),
  })
  .superRefine((index, context) => {
    const hashes = new Set<string>();
    index.features.forEach((feature, featureIndex) => {
      if (hashes.has(feature.imageHash)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Visual feature image hashes must be unique.',
          path: ['features', featureIndex, 'imageHash'],
        });
      }
      hashes.add(feature.imageHash);
    });
    const identities = new Set<string>();
    index.records.forEach((record, recordIndex) => {
      if (record.featureIndex >= index.features.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Visual record references an unknown feature.',
          path: ['records', recordIndex, 'featureIndex'],
        });
      }
      const identity = `${record.kind}\n${record.sourceSlug}\n${record.imageId}`;
      if (identities.has(identity)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Visual record identities must be unique.',
          path: ['records', recordIndex],
        });
      }
      identities.add(identity);
    });
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
    ...(item.images[0].dimensions ? { dimensions: item.images[0].dimensions } : {}),
    title: item.title,
    date: item.date,
    sourceImage: item.sourceImage,
    thumbnailImage: item.thumbnailImage,
    sourceImageAlt: item.sourceImageAlt,
    promptExcerpt: createStyleGalleryPromptExcerpt(primaryPrompt.prompt),
    promptCount: item.prompts.length,
    promptRevision: getStyleGalleryPromptRevision(item.prompts),
    imageHash: item.imageHash,
    imageCount: item.images.length,
    exampleCount,
  };
}

const STYLE_GALLERY_PROMPT_EXCERPT_LENGTH = 180;

/** 卡片只显示三行；180 字覆盖常见三列宽度，并避免不可见文本继续放大每次 SSR 的 JSON 成本。 */
export function createStyleGalleryPromptExcerpt(prompt: string): string {
  const normalized = normalizeStyleGalleryPrompt(prompt);
  if (normalized.length <= STYLE_GALLERY_PROMPT_EXCERPT_LENGTH) return normalized;
  return `${normalized.slice(0, STYLE_GALLERY_PROMPT_EXCERPT_LENGTH).trimEnd()}…`;
}

export function toStyleGalleryPromptSearchEntry(item: StoredStyleGalleryItem): string[] {
  return item.prompts.map((variant) => normalizeStyleGalleryPrompt(variant.prompt));
}

export function createStyleGalleryPromptSearchIndex(items: readonly StoredStyleGalleryItem[]): StyleGalleryPromptSearchIndex {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: Object.fromEntries(
      items.filter((item) => !item.draft).map((item) => [item.slug, toStyleGalleryPromptSearchEntry(item)]),
    ),
  };
}
