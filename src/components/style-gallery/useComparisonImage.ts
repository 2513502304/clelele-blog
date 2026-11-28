import {
  getReusableStyleGalleryImageUrl,
  isStyleGalleryImageUrlLoaded,
  preloadStyleGalleryImages,
  resolveStyleGalleryImageUrls,
} from '@lib/style-gallery-image-client';
import { getStyleGalleryImagePreviewSource } from '@lib/style-gallery-image-key';
import { useEffect, useState } from 'react';

/** Hand off the exact cache key painted on the card, then upgrade only after the original has decoded. */
export function useComparisonImage(source?: string, displayed?: Set<string>) {
  const [decoded, setDecoded] = useState<{ source: string; url: string }>();
  const candidate = source && getReusableStyleGalleryImageUrl(source, displayed?.has(source) ?? false);
  const original = candidate && isStyleGalleryImageUrlLoaded(candidate) ? candidate : undefined;
  useEffect(() => {
    if (!source || original) return;
    let active = true;
    async function upgrade(key: string) {
      const url =
        candidate ?? (await resolveStyleGalleryImageUrls([key]).catch(() => ({}) as Record<string, string>))[key] ?? key;
      if (!active) return;
      await preloadStyleGalleryImages([{ source: key, url, priority: 'high' }]);
      let ready = url;
      if (active && !isStyleGalleryImageUrlLoaded(url) && url !== key) {
        ready = key;
        await preloadStyleGalleryImages([{ source: key, url: key, priority: 'high' }]);
      }
      if (active && isStyleGalleryImageUrlLoaded(ready)) setDecoded({ source: key, url: ready });
    }
    void upgrade(source);
    return () => {
      active = false;
    };
  }, [source, original, candidate]);
  if (!source) return undefined;
  const preview = getStyleGalleryImagePreviewSource(source);
  return (
    original ??
    (decoded?.source === source ? decoded.url : undefined) ??
    getReusableStyleGalleryImageUrl(preview, displayed?.has(preview) ?? false) ??
    preview
  );
}
