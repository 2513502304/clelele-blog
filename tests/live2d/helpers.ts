import { expect, type Page } from '@playwright/test';
import sharp from 'sharp';

export const releaseIds = {
  anonDefault: '1d58a97e0077d03a6ea9aea65b7941d2b45cde0813d058e55b455880c5f92785',
  anonSr: 'f168e709a012d5844349ba433923a869420bb4c8cc2f4d043bef91b8cba54bdd',
  tomoriDefault: 'c282ced11b66f7f30488ba356deab4bffa3e27a734478b929093140b69ffe349',
  tomoriSr: 'd5628c18018a77031a8df09e24002c5b76c3de65378464a755b75a52327b56a0',
} as const;

export async function waitForLive2DReady(page: Page): Promise<void> {
  await expect(page.locator('.live2d-root')).toHaveAttribute('data-phase', 'ready', { timeout: 90_000 });
}

/** WebGL canvases cannot be inspected through a 2D context, so verify pixels from the browser-composited element image. */
export async function expectNonBlankCanvas(page: Page): Promise<void> {
  const screenshot = await page.locator('.live2d-canvas').screenshot();
  const { data, info } = await sharp(screenshot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visiblePixels = 0;
  for (let offset = 3; offset < data.length; offset += info.channels) {
    if (data[offset] > 8) visiblePixels += 1;
  }
  expect(visiblePixels).toBeGreaterThan(info.width * info.height * 0.02);
}

/** Match model bytes and the renderer code that must remain behind the mobile wake interaction. */
export function isLive2DTransferUrl(rawUrl: string): boolean {
  const url = new URL(rawUrl);
  const { pathname } = url;
  const isProxiedAsset = pathname.includes('/api/live2d-assets/');
  const isDirectBestdoriAsset = url.hostname === 's3.hf.co' && pathname.includes('/clelele0722/raw-datasets/bestdori/');
  const isSourceRendererModule =
    pathname.endsWith('/src/components/live2d/Live2DCanvas.tsx') || pathname.endsWith('/src/lib/live2d/renderer.ts');
  const isBuiltRendererChunk = /\/_astro\/(?:Live2DCanvas|renderer)[.-][^/]+\.js$/i.test(pathname);
  return isProxiedAsset || isDirectBestdoriAsset || isSourceRendererModule || isBuiltRendererChunk;
}

export function live2dRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (isLive2DTransferUrl(request.url())) requests.push(request.url());
  });
  return requests;
}

/** Optional motion/audio warming may continue across navigation; only these files prove a core model reload. */
export function isLive2DCoreModelRequest(rawUrl: string): boolean {
  const pathname = new URL(rawUrl).pathname;
  return (
    isLive2DTransferUrl(rawUrl) &&
    !pathname.includes('/data/motions/') &&
    !pathname.includes('/audio/') &&
    !pathname.endsWith('/dialogues.json')
  );
}
