const HPOI_IMAGE_HOST = 'rfx.hpoi.net';

/** Only permit Hpoi's public image CDN paths through the same-origin proxy. */
export function isAllowedHpoiImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === HPOI_IMAGE_HOST && url.pathname.startsWith('/gk/');
  } catch {
    return false;
  }
}

export function createHpoiImageProxyUrl(sourceUrl: string): string {
  return `/api/hpoi/image?source=${encodeURIComponent(sourceUrl)}`;
}
