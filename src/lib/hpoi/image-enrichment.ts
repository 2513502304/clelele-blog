import type { HpoiCollectionItem } from '@/types/hpoi';
import { readHpoiImageManifest } from './image-store';

/** Attach stable dimensions and immutable HF URLs before cards first render; metadata stays live. */
export async function withHpoiImages(items: HpoiCollectionItem[]): Promise<HpoiCollectionItem[]> {
  // Let storage errors reach the API: a 502 retains the client snapshot instead of downgrading to covers.
  const manifest = await readHpoiImageManifest();
  const missing = items.filter((item) => !manifest[item.id]).map((item) => item.id);
  if (missing.length)
    void import('./image-sync')
      .then(({ queueHpoiImages }) => queueHpoiImages(missing))
      .catch(() => console.warn('[hpoi-images] Background synchronization unavailable'));
  return items.map((item) => {
    const image = manifest[item.id];
    return image
      ? {
          ...item,
          imageUrl: `/api/hpoi/cached-image?key=${image.key.slice(8)}`,
          // A failed HF read can retry the same /pic/n/ source, never a low-resolution cover.
          imageFallbackUrl: image.sourceUrl,
          imageWidth: image.width,
          imageHeight: image.height,
          imageCrop:
            image.crop && image.sourceWidth && image.sourceHeight
              ? { ...image.crop, sourceWidth: image.sourceWidth, sourceHeight: image.sourceHeight }
              : undefined,
        }
      : { ...item, imageUrl: null, imageFallbackUrl: undefined };
  });
}
