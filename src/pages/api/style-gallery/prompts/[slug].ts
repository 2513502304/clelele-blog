import { getStoredStyleGalleryItem } from '@lib/style-gallery-store';
import type { APIRoute } from 'astro';

export const prerender = false;

/** 预览页仅在复制多 prompt item 时调用，避免把所有候选塞进全局 catalog。 */
export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug;
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return new Response('Invalid style gallery slug.', { status: 400 });

  const item = await getStoredStyleGalleryItem(slug);
  if (!item) return new Response('Style gallery item not found.', { status: 404 });

  return Response.json(
    {
      slug: item.slug,
      prompts: item.prompts.map(({ id, prompt, model, importedAt }) => ({ id, prompt, model, importedAt })),
    },
    // 客户端以 catalog.promptCount 作为查询版本；追加候选会使用新 URL，因此旧版本可长期由浏览器/CDN 复用。
    { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' } },
  );
};
