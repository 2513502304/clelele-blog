import { useEffect, useState } from 'react';
import { studioRequest } from '@lib/style-gallery-studio-client';
import type { GenerationPlatform } from '@lib/style-gallery-generation-settings';

export type Thumbnails = Map<string, { blob: Promise<Blob>; controller: AbortController; users: number }>;
export type ThumbnailProps = { pool: Thumbnails; url?: string; platform?: GenerationPlatform; credential: string };

/** Share only the authorized thumbnail bytes between a mounted card and reader.
 * The last subscriber aborts an unfinished fetch and releases the entry. */
export function useThumbnail({ pool, url, platform, credential }: ThumbnailProps) {
  const [ready, setReady] = useState<{ key: string; src: string }>();
  const key = platform && url ? `${platform}/${credential}/${url}` : '';
  useEffect(() => {
    if (!platform || !url || !key) return;
    let entry = pool.get(key);
    if (!entry) {
      const controller = new AbortController();
      const blob = studioRequest(url, platform, credential, undefined, controller.signal).then((r) => r.blob());
      entry = { controller, blob, users: 0 };
      pool.set(key, entry);
    }
    entry.users++;
    let active = true;
    let objectUrl = '';
    void entry.blob
      .then((blob) => {
        if (active) {
          objectUrl = URL.createObjectURL(blob);
          setReady({ key, src: objectUrl });
        }
      })
      .catch(() => {
        /* The original is fetched independently if the thumbnail is unavailable. */
      });
    return () => {
      active = false;
      setReady(undefined);
      URL.revokeObjectURL(objectUrl);
      if (--entry.users === 0) {
        entry.controller.abort();
        pool.delete(key);
      }
    };
  }, [key, pool, url, platform, credential]);
  return ready?.key === key ? ready.src : undefined;
}

/** Only a decoded, still-authorized original may enable publishing; the thumbnail is display-only. */
export function useStudioOriginal(url: string | undefined, platform: GenerationPlatform | undefined, credential: string) {
  const [result, setResult] = useState<{
    url: string;
    credential: string;
    platform: GenerationPlatform;
    image?: { blob: Blob; url: string };
    failed?: boolean;
  }>();
  useEffect(() => {
    if (!url || !platform) return;
    const ctrl = new AbortController();
    let objectUrl = '';
    void studioRequest(url, platform, credential, undefined, ctrl.signal)
      .then((r) => r.blob())
      .then(async (blob) => {
        if (ctrl.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        const image = new Image();
        image.src = objectUrl;
        await image.decode();
        if (!ctrl.signal.aborted) setResult({ url, platform, credential, image: { blob, url: objectUrl } });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setResult({ url, platform, credential, failed: true });
      });
    return () => {
      ctrl.abort();
      setResult(undefined);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, platform, credential]);
  return result && result.url === url && result.platform === platform && result.credential === credential ? result : undefined;
}
