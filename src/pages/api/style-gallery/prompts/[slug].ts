import { isAuthorizedStyleGalleryRequest } from '@lib/style-gallery-auth';
import { getStyleGalleryClientErrorResponse } from '@lib/style-gallery-errors';
import { getStyleGalleryPromptId, normalizeStyleGalleryPrompt } from '@lib/style-gallery-prompts';
import { getStyleGalleryItemCacheTag, setStyleGalleryPublicCacheHeaders } from '@lib/style-gallery-public-cache';
import { getStoredStyleGalleryItem } from '@lib/style-gallery-store';
import { writeStyleGalleryItems } from '@lib/style-gallery-write';
import type { APIRoute } from 'astro';
import { z } from 'zod';

const editSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), prompt: z.string().trim().min(1).max(100_000) }).strict();

/** Editing targets one content identity. Other variants and concurrent example uploads remain intact. */
export const PATCH: APIRoute = async ({ params, request }) => {
  if (!isAuthorizedStyleGalleryRequest(request)) return new Response('Invalid management token.', { status: 401 });
  const slug = params.slug;
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return new Response('Invalid slug.', { status: 400 });
  try {
    const text = await request.text();
    if (text.length > 110_000) return new Response('Prompt is too large.', { status: 413 });
    const body = editSchema.parse(JSON.parse(text));
    const item = await getStoredStyleGalleryItem(slug, { fresh: true });
    if (!item) return new Response('Item not found.', { status: 404 });
    if (!item.prompts.some((variant) => variant.id === body.id))
      return new Response('Prompt changed. Reopen the editor.', { status: 409 });
    const prompt = normalizeStyleGalleryPrompt(body.prompt);
    const id = getStyleGalleryPromptId(prompt);
    if (id !== body.id && item.prompts.some((variant) => variant.id === id))
      return new Response('This prompt already exists in another variant.', { status: 409 });
    const prompts = item.prompts.map((variant) => (variant.id === body.id ? { ...variant, id, prompt } : variant));
    if (id !== body.id)
      await writeStyleGalleryItems([{ ...item, examples: [], prompts }], 'replace-prompts', new Map([[slug, item.prompts]]));
    return Response.json({ prompts, activePromptId: id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return new Response('Invalid prompt.', { status: 400 });
    return getStyleGalleryClientErrorResponse(error) ?? new Response('Unable to save prompt. Please retry.', { status: 500 });
  }
};

export const prerender = false;

/**
 * 按需返回 prompt 候选和导入器所需的精确图片引用。
 *
 * 列表页仍只读取轻量 Catalog；浏览器复制多 prompt 或导入器命中既有图片时才调用本接口，避免把
 * prompt 全文与多图数组重新塞回全局索引，抵消 Catalog v5 的传输和解析优化。
 */
export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug;
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return new Response('Invalid style gallery slug.', { status: 400 });

  const item = await getStoredStyleGalleryItem(slug);
  if (!item) return new Response('Style gallery item not found.', { status: 404 });

  const headers = new Headers();
  setStyleGalleryPublicCacheHeaders(headers, [getStyleGalleryItemCacheTag(slug)]);
  return Response.json(
    {
      slug: item.slug,
      prompts: item.prompts.map(({ id, prompt, model, importedAt }) => ({ id, prompt, model, importedAt })),
      // 导入器需要复用既有图片的精确引用；轻量 catalog 刻意不保存多图数组，不能据其重建这些字段。
      item: {
        slug: item.slug,
        title: item.title,
        date: item.date,
        sourceImage: item.sourceImage,
        sourceImageAlt: item.sourceImageAlt,
        imageHash: item.imageHash,
        images: item.images,
      },
    },
    // 客户端以 catalog.promptRevision 作为查询版本；写入还会精准清除此 item 的 CDN tag。
    { headers },
  );
};
