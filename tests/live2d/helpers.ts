import { expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import bootstrapCatalog from '../../src/data/live2d/catalog.json' with { type: 'json' };

/** Keep remote-asset assertions tied to the shipped bootstrap instead of historical release hashes. */
export function fixtureCostume(characterId: string, costumeId: string) {
  const costume = bootstrapCatalog.characters.find((c) => c.id === characterId)?.costumes.find((c) => c.id === costumeId);
  if (!costume) throw new Error(`Missing bootstrap fixture ${characterId}/${costumeId}`);
  return costume;
}

export const releaseIds = {
  anonDefault: fixtureCostume('chihaya-anon', 'default').releaseId,
  anonSr: fixtureCostume('chihaya-anon', 'live-sr-01').releaseId,
  tomoriDefault: fixtureCostume('takamatsu-tomori', 'default').releaseId,
  tomoriSr: fixtureCostume('takamatsu-tomori', 'live-sr-01').releaseId,
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
  const isNativeRuntime = pathname.startsWith('/vendor/ournotes-player-');
  return isProxiedAsset || isDirectBestdoriAsset || isSourceRendererModule || isBuiltRendererChunk || isNativeRuntime;
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
