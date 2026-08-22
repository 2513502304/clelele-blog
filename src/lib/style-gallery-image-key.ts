const STYLE_GALLERY_IMAGE_API_PREFIX = '/api/style-gallery/image/';

/** Gallery 允许公开签名的对象范围；拒绝任意 bucket key，避免批量接口扩大读取权限。 */
export function isAllowedStyleGalleryImageKey(key: string): boolean {
  if (key.includes('..') || key.includes('\\')) return false;
  if (/^\/?(source|thumb)\/[a-f0-9]{12}\.(jpg|jpeg|png|webp)$/i.test(key)) return true;
  return /^\/?examples\/images\/[a-f0-9]{64}\.(jpg|jpeg|png|webp)$/i.test(key);
}

/** 从站内图片 API 地址恢复 HF object key；外部 URL 与非 Gallery 路径不会进入签名队列。 */
export function parseStyleGalleryImageApiPath(value: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(value, 'https://style-gallery.local').pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(STYLE_GALLERY_IMAGE_API_PREFIX)) return null;
  const key = decodeURIComponent(pathname.slice(STYLE_GALLERY_IMAGE_API_PREFIX.length));
  return isAllowedStyleGalleryImageKey(key) ? key : null;
}

export function createStyleGalleryImageApiPath(key: string): string {
  if (!isAllowedStyleGalleryImageKey(key)) throw new Error(`Invalid style gallery image key: ${key}`);
  return `${STYLE_GALLERY_IMAGE_API_PREFIX}${key}`;
}
