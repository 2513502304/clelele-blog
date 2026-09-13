import { randomUUID } from 'node:crypto';
import type { StyleGalleryPlatform } from '@lib/style-gallery-platforms';
import { STYLE_GALLERY_PREPARE_BATCH_SIZE } from '@lib/style-gallery-request-batches';
import type { StyleGalleryExample } from '@/types/style-gallery';
import { getStyleGalleryExampleThumbnailKey } from './style-gallery-image-key';

export { MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE } from '@lib/style-gallery-chunk-upload';
export { getStyleGalleryExampleExtension } from '@lib/style-gallery-image-type';

export const MAX_STYLE_GALLERY_EXAMPLE_FILES = STYLE_GALLERY_PREPARE_BATCH_SIZE;

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

/** A derivative is shared by hash, even if historical originals used different extensions. */
export function getUnreferencedStyleGalleryExampleAssetKeys(
  examples: StyleGalleryExample[],
  referencedSources: Set<string>,
): string[] {
  const referencedThumbnails = new Set([...referencedSources].map(getStyleGalleryExampleThumbnailKey));
  const keys = new Set<string>();
  for (const example of examples) {
    if (!referencedSources.has(example.src)) keys.add(getStyleGalleryExampleObjectKey(example));
    const thumbnail = getStyleGalleryExampleThumbnailKey(example.src);
    if (!referencedThumbnails.has(thumbnail)) keys.add(thumbnail);
  }
  return [...keys];
}
