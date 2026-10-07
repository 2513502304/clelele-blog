import { chromium } from '@playwright/test';
import sharp from 'sharp';

/** Current-version diagnostic with real React progressive cards and decoded images.
 * First run the generation-fixture dev server on 4340 with GALLERY_SCROLL_FIXTURE=1.
 * Then run: node tests/style-gallery/ambient-scroll-bench.mjs
 * Request/frame counts describe this isolated machine, not production FPS or a revision comparison.
 */
const textures = await Promise.all(
  Array.from({ length: 16 }, (_, i) =>
    sharp(new URL('../../public/img/cover/6.webp', import.meta.url).pathname)
      .resize(1664, 2432)
      .modulate({ hue: i * 20 })
      .webp()
      .toBuffer(),
  ),
);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 870 }, deviceScaleFactor: 2 });
  const requests = new Map();
  await page.route('**/*', (route) => {
    const request = route.request();
    if (request.resourceType() !== 'image') return route.continue();
    const url = request.url();
    requests.set(url, (requests.get(url) ?? 0) + 1);
    const index = Number.parseInt(new URL(url).pathname.match(/([a-f0-9]{12})\./)?.[1] ?? '0', 16) % textures.length;
    return route.fulfill({ contentType: 'image/webp', body: textures[index] });
  });
  await page.route('**/api/live2d**', (route) => route.abort());
  await page.goto('http://127.0.0.1:4340/image-style-prompt-gallery');
  await page.locator('[data-gallery-layout] article').first().waitFor();
  await page.waitForFunction(() => document.querySelector('#ambient-effects').dataset.running === 'true');
  await page.evaluate(() => {
    window.scrollProbe = { frames: [], longTasks: [] };
    const context = document.querySelector('#ambient-effects').getContext('2d');
    const clear = context.clearRect.bind(context);
    context.clearRect = (...args) => {
      window.scrollProbe.frames.push(performance.now());
      clear(...args);
    };
    new PerformanceObserver((list) => {
      window.scrollProbe.longTasks.push(...list.getEntries().map((entry) => entry.duration));
    }).observe({ type: 'longtask' });
  });
  await page.mouse.move(800, 600);
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 650);
    await page.waitForTimeout(35);
  }
  const loaded = await page
    .locator('[data-gallery-layout] img')
    .evaluateAll((images) =>
      images.filter((image) => image.complete && image.naturalWidth > 0).map((image) => image.currentSrc),
    );
  const before = new Map(requests);
  const middleY = await page.evaluate(() => scrollY);
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, -650);
    await page.waitForTimeout(35);
  }
  const result = await page.evaluate(() => ({
    frames: window.scrollProbe.frames.length,
    maxFrameGapMs: Math.max(...window.scrollProbe.frames.slice(1).map((time, i) => time - window.scrollProbe.frames[i])),
    longTasksMs: window.scrollProbe.longTasks,
    mountedCards: document.querySelector('[data-gallery-layout]').children.length,
    finalScrollY: scrollY,
  }));
  if (result.mountedCards <= 24 || middleY < 4000 || result.finalScrollY >= middleY / 2) {
    throw new Error('Progressive scrolling not exercised; start the server with GALLERY_SCROLL_FIXTURE=1');
  }
  console.log(
    JSON.stringify({
      ...result,
      middleY,
      repeatedLoadedImageRequests: loaded.reduce((sum, url) => sum + ((requests.get(url) ?? 0) - (before.get(url) ?? 0)), 0),
    }),
  );
} finally {
  await browser.close();
}
