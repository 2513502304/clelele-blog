import { invalidateByTag } from '@vercel/functions';

export const STYLE_GALLERY_LIST_CACHE_TAG = 'style-gallery-lists';
export const STYLE_GALLERY_PUBLIC_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
export const STYLE_GALLERY_VERCEL_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=2592000';

export function getStyleGalleryItemCacheTag(slug: string): string {
  return `style-gallery-item-${slug}`;
}

/**
 * 浏览器每次仍向站点确认新鲜度，Vercel 边缘节点则复用 SSR 结果 24 小时；写操作通过 tag 精准失效。
 * 这样不会依赖进程内缓存，也不会引入额外存储费用，冷节点或爬虫首次访问后均可直接命中 CDN。
 */
export function setStyleGalleryPublicCacheHeaders(headers: Headers, tags: readonly string[]): void {
  headers.set('Cache-Control', STYLE_GALLERY_PUBLIC_CACHE_CONTROL);
  headers.set('Vercel-CDN-Cache-Control', STYLE_GALLERY_VERCEL_CACHE_CONTROL);
  headers.set('Vercel-Cache-Tag', [...new Set(tags)].join(', '));
}

/**
 * Gallery 持久化成功后才把相关 CDN 条目标记为 stale：列表 tag 覆盖预览、矩阵、Sub-gallery
 * 和搜索索引，item tag 只影响发生变化的详情与 prompt 响应。下一次读取先返回旧结果并在后台
 * 再验证，避免高并发写入后强制删除缓存造成 SSR stampede。失效失败不能回滚已经提交到 HF 的事实，
 * 因此仅记录错误。
 */
export async function invalidateStyleGalleryPublicCache(slugs: readonly string[] = []): Promise<void> {
  const tags = [STYLE_GALLERY_LIST_CACHE_TAG, ...slugs.map(getStyleGalleryItemCacheTag)];
  try {
    await invalidateByTag([...new Set(tags)]);
  } catch (error) {
    console.error('[style-gallery] Durable data was saved but Vercel CDN cache invalidation failed.', error);
  }
}
