import { randomUUID } from 'node:crypto';
import type { StyleGalleryPlatform } from '@lib/style-gallery-platforms';
import type { StyleGalleryExample } from '@/types/style-gallery';

export { MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE } from '@lib/style-gallery-chunk-upload';

export const MAX_STYLE_GALLERY_EXAMPLE_FILES = 32;

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function getStyleGalleryExampleExtension(contentType: string, fileName = ''): string {
  const contentTypeExtension = IMAGE_EXTENSIONS[contentType];
  if (contentTypeExtension) return contentTypeExtension;
  const match = fileName.toLowerCase().match(/\.(jpe?g|png|webp)$/);
  if (match?.[1]) return match[1] === 'jpeg' ? 'jpg' : match[1];
  throw new Error(`Unsupported image type: ${contentType || fileName}`);
}

export function getStyleGalleryExampleKey(imageHash: string, extension: string): string {
  return `examples/images/${imageHash}.${extension.toLowerCase()}`;
}

export function createStyleGalleryExample(
  title: string,
  platform: StyleGalleryPlatform,
  imageHash: string,
  extension: string,
  note?: string,
): StyleGalleryExample {
  const key = getStyleGalleryExampleKey(imageHash, extension);
  return {
    id: randomUUID(),
    src: `/api/style-gallery/image/${key}`,
    alt: `${title} ${platform.label} example`,
    model: platform.label,
    note: note?.trim() || undefined,
    uploadedAt: new Date().toISOString(),
    imageHash,
  };
}

export function getStyleGalleryExampleObjectKey(example: StyleGalleryExample): string {
  const prefix = '/api/style-gallery/image/';
  if (!example.src.startsWith(prefix)) throw new Error(`Invalid example image URL: ${example.src}`);
  const key = example.src.slice(prefix.length);
  if (!/^examples\/images\/[a-f0-9]{64}\.(jpg|jpeg|png|webp)$/i.test(key)) {
    throw new Error(`Invalid example image URL: ${example.src}`);
  }
  const fileHash = key.split('/').at(-1)?.split('.')[0];
  if (fileHash !== example.imageHash) throw new Error(`Example image hash does not match its URL: ${example.src}`);
  return key;
}
