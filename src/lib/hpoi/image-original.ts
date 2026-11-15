import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { isAllowedHpoiImageUrl } from './image';
import { type CachedHpoiImage, hpoiImageStorage } from './image-store';

/** Only /pic/n/ bytes may be published as a card image. Metadata reads never re-encode the image. */
export async function cacheHpoiOriginal(sourceUrl: string, bytes: Buffer, crop?: CachedHpoiImage['crop']) {
  if (!isAllowedHpoiImageUrl(sourceUrl) || !new URL(sourceUrl).pathname.startsWith('/gk/pic/n/'))
    throw new Error('Hpoi card images require a /pic/n/ original');
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height || !['jpeg', 'png', 'webp'].includes(meta.format ?? ''))
    throw new Error('Unsupported Hpoi original');
  if (
    crop &&
    (crop.left < 0 ||
      crop.top < 0 ||
      crop.width <= 0 ||
      crop.height <= 0 ||
      crop.left + crop.width > meta.width ||
      crop.top + crop.height > meta.height)
  )
    throw new Error('Invalid Hpoi poster viewport');
  const extension = meta.format === 'jpeg' ? 'jpg' : meta.format;
  const key = `objects/${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
  const client = hpoiImageStorage();
  if (!(await client.head(key)).exists) await client.put(key, bytes, `image/${meta.format}`);
  return {
    key,
    originalKey: key,
    fallbackKey: key,
    sourceUrl,
    width: crop?.width ?? meta.width,
    height: crop?.height ?? meta.height,
    sourceWidth: meta.width,
    sourceHeight: meta.height,
    crop,
  };
}
