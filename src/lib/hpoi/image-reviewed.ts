import type { CachedHpoiImage } from './image-store';

/** Visually verified on 2026-11-16. SSIM alone confused accessories/plain backgrounds with
 * the cover's group/street/interior scene. Pin the actual source, never a gallery ordinal. */
export const reviewedHpoiOriginals: Record<string, { url: string; crop?: CachedHpoiImage['crop'] }> = {
  '102348': { url: 'https://rfx.hpoi.net/gk/pic/n/2025/01/45895d8fedd246e48127c4bd67c9a0c7.jpg' },
  '112019': { url: 'https://rfx.hpoi.net/gk/pic/n/2026/01/9e55099e22294a6e97dae90aa97ec6dc.jpg' },
  '116622': { url: 'https://rfx.hpoi.net/gk/pic/n/2025/11/149fb4827ae14eae9cbd40d7a9e73b08.jpg' },
  // The only matching official source is a 1000×22691 poster. Display its front-view panel
  // with CSS; keep the downloaded poster intact in HF and the browser response.
  '114222': {
    url: 'https://rfx.hpoi.net/gk/pic/n/2026/02/2c998fe6bba74624b2e6831c303b354c.jpg',
    crop: { left: 20, top: 3220, width: 960, height: 1460 },
  },
};
