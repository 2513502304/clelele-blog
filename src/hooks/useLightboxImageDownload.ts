import { type ImageDownloadProgress, readImageDownload } from '@lib/image-download-progress';
import { isStyleGalleryImagePreloading, isStyleGalleryImageUrlLoaded } from '@lib/style-gallery-image-client';
import { useEffect, useState } from 'react';

function canTrackDownload(source: string): boolean {
  if (typeof document === 'undefined' || /^(data|blob):/.test(source)) return false;
  if (isStyleGalleryImageUrlLoaded(source) || isStyleGalleryImagePreloading(source)) return false;
  try {
    const url = new URL(source, document.baseURI);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    // A card may already be downloading this exact URL. Preserve its native request/cache key.
    return !Array.from(document.images).some((image) => (image.currentSrc || image.src) === url.href);
  } catch {
    return false;
  }
}

/** Track only cold originals; native cards/preloads keep their existing requests and cached image URLs. */
export function useLightboxImageDownload(source: string) {
  const [initial] = useState(() => ({ source, track: canTrackDownload(source) }));
  const [download, setDownload] = useState<{ src?: string; progress?: ImageDownloadProgress }>({});
  // A failed signed URL falls back through the existing native image error path, without another stream retry.
  const track = initial.track && initial.source === source;
  useEffect(() => {
    if (!track) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void fetch(source, { signal: controller.signal, credentials: 'same-origin', priority: 'high' })
      .then((response) =>
        readImageDownload(response, controller.signal, (progress) => {
          if (!controller.signal.aborted) setDownload({ progress });
        }),
      )
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setDownload((current) => ({ ...current, src: objectUrl }));
      })
      .catch(() => {
        // Some article image hosts do not allow CORS. Native <img> remains the universal fallback.
        if (!controller.signal.aborted) setDownload({ src: source });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, track]);
  return track ? download : { src: source };
}
