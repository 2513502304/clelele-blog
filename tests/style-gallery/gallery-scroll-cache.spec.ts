import { expect, test } from '@playwright/test';
import sharp from 'sharp';

// GALLERY_SCROLL_FIXTURE=1 npx playwright test --config playwright.generation-notes.config.ts gallery-scroll-cache
test.skip(process.env.GALLERY_SCROLL_FIXTURE !== '1', 'Uses the opt-in 192-item catalog, not the single-detail fixture');

test('progressive cards retain loaded URLs on reverse scrolling while particles continue drawing', async ({ page }) => {
  const images = await Promise.all(
    Array.from({ length: 8 }, (_, hue) =>
      sharp('public/img/cover/6.webp')
        .resize(1664, 2432)
        .modulate({ hue: hue * 40 })
        .webp()
        .toBuffer(),
    ),
  );
  const requests = new Map<string, number>();
  await page.route('**/*', (route) => {
    const request = route.request();
    if (request.resourceType() !== 'image') return route.continue();
    const url = request.url();
    requests.set(url, (requests.get(url) ?? 0) + 1);
    const id = Number.parseInt(new URL(url).pathname.match(/([a-f0-9]{12})\./)?.[1] ?? '0', 16);
    return route.fulfill({ contentType: 'image/webp', body: images[id % images.length] });
  });
  await page.route('**/api/live2d**', (route) => route.abort());
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/image-style-prompt-gallery');
  const cards = page.locator('[data-gallery-layout] article');
  await expect(cards).toHaveCount(24);
  const first = cards.first().locator('img');
  await expect.poll(() => first.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  const firstUrl = await first.getAttribute('src');
  const canvas = page.locator('#ambient-effects');
  await expect(canvas).toHaveAttribute('data-running', 'true');
  await canvas.evaluate((el: HTMLCanvasElement) => {
    const context = el.getContext('2d');
    if (!context) throw new Error('Missing particle renderer');
    const clear = context.clearRect.bind(context);
    context.clearRect = (...args) => {
      el.dataset.frames = String(Number(el.dataset.frames ?? 0) + 1);
      clear(...args);
    };
  });
  await page.mouse.move(800, 600);
  for (let i = 0; i < 28; i++) {
    await page.mouse.wheel(0, 650);
    await page.waitForTimeout(40);
  }
  await expect.poll(() => cards.count()).toBeGreaterThan(48);
  const middleY = await page.evaluate(() => scrollY);
  expect(middleY).toBeGreaterThan(4000);
  // Track only images that finished loading; first visits to lazy images are not
  // repeated requests. Real React appends/re-renders run throughout this test.
  const loaded = await cards
    .locator('img')
    .evaluateAll((nodes: HTMLImageElement[]) =>
      nodes.filter((el) => el.complete && el.naturalWidth > 0).map((el) => el.currentSrc),
    );
  const before = new Map(requests);
  let previousFrames = Number(await canvas.getAttribute('data-frames'));
  for (let batch = 0; batch < 4; batch++) {
    for (let i = 0; i < 7; i++) {
      await page.mouse.wheel(0, -650);
      await page.waitForTimeout(40);
    }
    const frames = Number(await canvas.getAttribute('data-frames'));
    expect(frames, 'particles paused through an entire wheel-input batch').toBeGreaterThan(previousFrames);
    previousFrames = frames;
  }
  expect(await page.evaluate(() => scrollY)).toBeLessThan(middleY / 2);
  expect(await first.getAttribute('src')).toBe(firstUrl);
  for (const url of loaded) expect(requests.get(url), `already-loaded image requested again: ${url}`).toBe(before.get(url));

  // Updating typography or banner filters must not clear an unrelated animation
  // synchronously. The next RAF remains free to draw its normal frame.
  expect(
    await canvas.evaluate((el) => {
      const before = el.getAttribute('data-frames');
      window.dispatchEvent(new Event('reading-change'));
      window.dispatchEvent(new Event('scenery-change'));
      return el.getAttribute('data-frames') === before;
    }),
  ).toBe(true);
});
