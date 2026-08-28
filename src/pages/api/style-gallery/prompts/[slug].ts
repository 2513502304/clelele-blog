import { getStyleGalleryItemCacheTag, setStyleGalleryPublicCacheHeaders } from '@lib/style-gallery-public-cache';
import { getStoredStyleGalleryItem } from '@lib/style-gallery-store';
import type { APIRoute } from 'astro';

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
        thumbnailImage: item.thumbnailImage,
        sourceImageAlt: item.sourceImageAlt,
        imageHash: item.imageHash,
        images: item.images,
      },
    },
    // 客户端以 catalog.promptRevision 作为查询版本；写入还会精准清除此 item 的 CDN tag。
    { headers },
  );
};
