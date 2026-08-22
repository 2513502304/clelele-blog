import { styleGalleryVisualFeatureSchema } from '@lib/style-gallery-schema';
import { getStyleGalleryVisualIndex } from '@lib/style-gallery-store';
import { searchStyleGalleryVisualIndex } from '@lib/style-gallery-visual-index';
import type { APIRoute } from 'astro';
import { z } from 'zod';

export const prerender = false;

const imageSearchSchema = z.object({
  mode: z.enum(['combined', 'near-duplicate', 'semantic']),
  scope: z.enum(['source', 'example']),
  feature: styleGalleryVisualFeatureSchema,
  range: z.number().int().min(0).max(100).default(50),
  limit: z.number().int().min(1).max(10_000).optional(),
});
const paletteSearchSchema = z.object({
  mode: z.literal('palette'),
  scope: z.enum(['source', 'example']),
  color: z.string().regex(/^#[a-f0-9]{6}$/i),
  range: z.number().int().min(0).max(100).default(50),
  limit: z.number().int().min(1).max(10_000).optional(),
});
const requestSchema = z.union([imageSearchSchema, paletteSearchSchema]);

/**
 * 查询只上传本地计算出的紧凑特征，不上传用户选择的原始图片。服务端扫描短期缓存的 HF 派生索引，
 * 返回可映射到当前页面数据的稳定 ID；分数只在服务端用于截断和排序，不传输页面当前不使用的字段。
 * 即使索引稍后于图片 metadata，页面也只会忽略无对应项的结果。
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = requestSchema.parse(await request.json());
    const index = await getStyleGalleryVisualIndex();
    const results = searchStyleGalleryVisualIndex(index, body);
    const matches = results.map((result) => (body.scope === 'source' ? result.sourceSlug : result.imageId));
    return Response.json(
      { matches, indexedImages: index.records.length, updatedAt: index.updatedAt },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) return new Response(error.message, { status: 400 });
    console.error('[style-gallery] Visual search request failed.', error);
    return new Response('Visual search failed.', { status: 500 });
  }
};
