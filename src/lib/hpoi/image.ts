const HPOI_IMAGE_HOST = 'rfx.hpoi.net';

/** 只允许 Hpoi 公开图片 CDN 路径进入同源代理。 */
export function isAllowedHpoiImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === HPOI_IMAGE_HOST && url.pathname.startsWith('/gk/');
  } catch {
    return false;
  }
}

/** 生成同源图片代理地址，避免浏览器直接依赖 Hpoi CDN 的 Referer 与跨域策略。 */
export function createHpoiImageProxyUrl(sourceUrl: string): string {
  return `/api/hpoi/image?source=${encodeURIComponent(sourceUrl)}`;
}
