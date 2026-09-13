import sharp from 'sharp';
import { headStyleGalleryObject, putStyleGalleryObject } from './hf-s3-presign';
import { getStyleGalleryExampleThumbnailKey } from './style-gallery-image-key';

/** A 640px preview covers four-column Retina cards without shipping full-resolution pixels. */
export async function encodeStyleGalleryExampleThumbnail(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes).rotate().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 76 }).toBuffer();
}

/** Run only during uploads/backfills, never while serving a gallery or signing an image. */
export async function ensureStyleGalleryExampleThumbnail(source: string, bytes: Uint8Array): Promise<void> {
  const key = getStyleGalleryExampleThumbnailKey(source);
  if (await headStyleGalleryObject(key)) return;
  const thumbnail = await encodeStyleGalleryExampleThumbnail(bytes);
  await putStyleGalleryObject(key, thumbnail, 'image/webp');
}
