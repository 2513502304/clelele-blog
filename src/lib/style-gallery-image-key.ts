const STYLE_GALLERY_IMAGE_API_PREFIX = '/api/style-gallery/image/';
/** 客户端和签名 API 共用同一批量上限，避免预取窗口扩大后出现整批 400。 */
export const STYLE_GALLERY_IMAGE_SIGN_BATCH_SIZE = 48;

/** Gallery 允许公开签名的对象范围；拒绝任意 bucket key，避免批量接口扩大读取权限。 */
export function isAllowedStyleGalleryImageKey(key: string): boolean {
  if (key.includes('..') || key.includes('\\')) return false;
  if (/^\/?(source|thumb)\/[a-f0-9]{12}\.(jpg|jpeg|png|webp)$/i.test(key)) return true;
  return /^\/?examples\/images\/[a-f0-9]{64}\.(jpg|jpeg|png|webp)$/i.test(key);
}

/** 从站内图片 API 地址恢复 HF object key；外部 URL 与非 Gallery 路径不会进入签名队列。 */
export function parseStyleGalleryImageApiPath(value: string): string | null {
  let key: string;
  try {
    const pathname = new URL(value, 'https://style-gallery.local').pathname;
    if (!pathname.startsWith(STYLE_GALLERY_IMAGE_API_PREFIX)) return null;
    key = decodeURIComponent(pathname.slice(STYLE_GALLERY_IMAGE_API_PREFIX.length));
  } catch {
    // URL 构造和百分号解码都可能失败；单个坏地址不应中断整个批量签名窗口。
    return null;
  }
  return isAllowedStyleGalleryImageKey(key) ? key : null;
}

export function createStyleGalleryImageApiPath(key: string): string {
  if (!isAllowedStyleGalleryImageKey(key)) throw new Error(`Invalid style gallery image key: ${key}`);
  return `${STYLE_GALLERY_IMAGE_API_PREFIX}${key}`;
}
