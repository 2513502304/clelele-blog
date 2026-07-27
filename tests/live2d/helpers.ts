import { expect, type Page } from '@playwright/test';
import sharp from 'sharp';

export const releaseIds = {
  anonDefault: '9e95d66201f07e339bd5542b1dd0d67ae1bd0b0f9b14a7335ca0bad6bd5916ad',
  anonSr: '63efa2f7902818e27ad2c3ec71b3cbcc6c83ee4b4c8c4176b2e7f764422f3e85',
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

export function live2dRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/live2d-assets/')) requests.push(request.url());
  });
  return requests;
}
