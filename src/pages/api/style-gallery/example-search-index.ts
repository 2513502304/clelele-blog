import { getStyleGalleryExampleSearchIndex } from '@lib/style-gallery';
import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Prompt 搜索索引不嵌入 Sub-gallery SSR；仅搜索用户按需下载，并由浏览器与 CDN 复用。
 * 较短的浏览器缓存兼顾连续访问，较长的 CDN 缓存降低 Function 响应流量与重复 CPU。
 */
export const GET: APIRoute = async () => {
  try {
    return Response.json(await getStyleGalleryExampleSearchIndex(), {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' },
    });
  } catch (error) {
    console.error('Failed to build the Sub-gallery prompt search index:', error);
    return new Response('Failed to load the Sub-gallery prompt search index.', { status: 503 });
  }
};
