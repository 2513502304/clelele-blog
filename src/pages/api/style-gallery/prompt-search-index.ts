import { getStyleGalleryPromptSearchTextIndex } from '@lib/style-gallery';
import { STYLE_GALLERY_LIST_CACHE_TAG, setStyleGalleryPublicCacheHeaders } from '@lib/style-gallery-public-cache';
import type { APIRoute } from 'astro';

export const prerender = false;

/** 完整 prompt 搜索文本只在用户开始搜索时返回；普通 SSR 始终使用轻量 Catalog。 */
export const GET: APIRoute = async () => {
  try {
    const headers = new Headers();
    setStyleGalleryPublicCacheHeaders(headers, [STYLE_GALLERY_LIST_CACHE_TAG]);
    return Response.json(await getStyleGalleryPromptSearchTextIndex(), { headers });
  } catch (error) {
    console.error('Failed to build the Style Gallery prompt search index:', error);
    return new Response('Failed to load the Style Gallery prompt search index.', { status: 503 });
  }
};
