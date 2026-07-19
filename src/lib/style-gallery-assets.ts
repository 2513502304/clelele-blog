import { createHash } from 'node:crypto';
import type { StoredStyleGalleryItem } from '@/types/style-gallery';

const IMAGE_API_PREFIX = '/api/style-gallery/image/';
const ASSET_KEY_PATTERN = /^(source|thumb)\/[a-zA-Z0-9._-]+$/;

export function getStyleGalleryAssetKey(path: string): string {
  if (!path.startsWith(IMAGE_API_PREFIX)) throw new Error(`Invalid style gallery image path: ${path}`);
  const key = path.slice(IMAGE_API_PREFIX.length);
  if (!ASSET_KEY_PATTERN.test(key)) throw new Error(`Invalid style gallery asset key: ${key}`);
  return key;
}

/** 收集 item 中去重后的原图与缩略图对象键，用于写入前 HEAD 校验和失败清理。 */
export function getStyleGalleryItemAssetKeys(item: StoredStyleGalleryItem): string[] {
  const paths = item.images
    .flatMap((image) => [image.sourceImage, image.thumbnailImage])
    .filter((path): path is string => Boolean(path));
  return [...new Set(paths.map(getStyleGalleryAssetKey))];
}

export function isStyleGalleryAssetKey(key: string): boolean {
  return ASSET_KEY_PATTERN.test(key);
}

/**
 * 校验 item 元数据与图片资产命名的不变量。
 *
 * 顶层图片必须等于 `images[0]`，文件名前缀必须来自对应 SHA-256；多图 item 的总哈希按图片输入顺序
 * 拼接各图哈希后再次计算。该顺序不可随意排序，否则会改变 item 身份。
 */
export function assertStyleGalleryItemConsistency(item: StoredStyleGalleryItem): void {
  const firstImage = item.images[0];
  if (
    item.sourceImage !== firstImage.sourceImage ||
    item.thumbnailImage !== firstImage.thumbnailImage ||
    item.sourceImageAlt !== firstImage.sourceImageAlt
  ) {
    throw new Error(`Top-level image fields do not match the first image for ${item.slug}.`);
  }

  for (const image of item.images) {
    const shortHash = image.imageHash.slice(0, 12);
    if (!getStyleGalleryAssetKey(image.sourceImage).split('/').at(-1)?.startsWith(`${shortHash}.`)) {
      throw new Error(`Source image filename does not match its hash for ${item.slug}.`);
    }
    if (image.thumbnailImage && !getStyleGalleryAssetKey(image.thumbnailImage).split('/').at(-1)?.startsWith(`${shortHash}.`)) {
      throw new Error(`Thumbnail filename does not match its hash for ${item.slug}.`);
    }
  }

  const expectedItemHash =
    item.images.length === 1
      ? item.images[0].imageHash
      : createHash('sha256')
          .update(item.images.map((image) => image.imageHash).join('\n'))
          .digest('hex');
  if (item.imageHash !== expectedItemHash) throw new Error(`Item hash does not match its image group for ${item.slug}.`);
}
