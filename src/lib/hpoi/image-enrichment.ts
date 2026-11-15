import type { HpoiCollectionItem } from '@/types/hpoi';
import { readHpoiImageManifest } from './image-store';

/** Attach stable dimensions and immutable HF URLs before cards first render; metadata stays live. */
export async function withHpoiImages(items: HpoiCollectionItem[]): Promise<HpoiCollectionItem[]> {
  try {
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
            imageFallbackUrl: `/api/hpoi/cached-image?key=${image.fallbackKey.slice(8)}`,
            imageWidth: image.width,
            imageHeight: image.height,
          }
        : item;
    });
  } catch {
    // Storage outage must not hide the public collection. Retry on a later uncached page request.
    return items;
  }
}
