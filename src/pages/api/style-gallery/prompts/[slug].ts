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
    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=300' } },
  );
};
