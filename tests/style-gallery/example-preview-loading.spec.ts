import { expect, type Page, test } from '@playwright/test';

const svg = (width: number, height: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="pink"/></svg>`;
const original = `/api/style-gallery/image/examples/images/${'1'.repeat(64)}.png`;
const thumb = `/api/style-gallery/image/examples/thumbs/${'1'.repeat(64)}.webp`;

async function openGallery(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('astro-island[component-url*="ImageLightbox"]')).not.toHaveAttribute('ssr');
  // The server renders the default grouped view until nuqs applies the URL after hydration.
  if (path.includes('grouped=false')) {
    await expect(page.getByRole('button', { name: '同源折叠', exact: true })).toHaveAttribute('aria-pressed', 'false');
  }
}

for (const path of [
  '/image-style-prompt-gallery/examples?grouped=false',
  '/image-style-prompt-gallery/2026-09-23-35dc5191ccad',
]) {
  test(`${path}: cards use previews, the viewer uses originals, and a second open reuses bytes`, async ({ page }) => {
    let originalRequests = 0;
    let release: (() => void) | undefined;
    await page.route(/^https?:\/\//, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === original) {
        originalRequests++;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return route.fulfill({ contentType: 'image/svg+xml', headers: { 'cache-control': 'no-store' }, body: svg(1280, 1920) });
      }
      if (url.pathname.includes('/examples/thumbs/'))
        return route.fulfill({ contentType: 'image/svg+xml', body: svg(640, 960) });
      if (route.request().resourceType() === 'image' || url.pathname.includes('/api/live2d')) return route.abort();
      return route.continue();
    });
    await openGallery(page, path);
    const trigger = page.locator(`[data-gallery-original="${original}"]`);
    await trigger.scrollIntoViewIfNeeded();
    const cardImage = trigger.locator('..').locator('img').first();
    await expect(cardImage).toHaveAttribute('src', thumb);
    await expect.poll(() => cardImage.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(640);
    expect(originalRequests).toBe(0);
    // Programmatic click excludes the separate hover-preload path from this cold-cache test.
    await trigger.evaluate((el: HTMLButtonElement) => el.click());
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('progressbar')).toBeVisible();
    await expect.poll(() => originalRequests).toBe(1);
    await expect(dialog.locator(`img[src="${thumb}"]`)).toBeVisible();
    release?.();
    await expect(dialog.getByRole('progressbar')).toHaveCount(0);
    await expect.poll(() => dialog.locator('img[src^="blob:"]').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1280);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await trigger.evaluate((el: HTMLButtonElement) => el.click());
    await expect(dialog.locator('img[src^="blob:"]')).toBeVisible();
    expect(originalRequests).toBe(1);
  });
}

test('missing example previews fall back to the original without changing the card bounds', async ({ page }) => {
  await page.route(/^https?:\/\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes('/examples/thumbs/')) return route.fulfill({ status: 404, body: 'missing preview' });
    if (path.includes('/examples/images/')) return route.fulfill({ contentType: 'image/svg+xml', body: svg(1280, 1920) });
    if (route.request().resourceType() === 'image' || path.includes('/api/live2d')) return route.abort();
    return route.continue();
  });
  await openGallery(page, '/image-style-prompt-gallery/examples?grouped=false');
  const image = page.locator(`[data-gallery-original="${original}"]`).locator('..').locator('img').first();
  await expect(image).toHaveAttribute('src', original);
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1280);
  const ratio = await image.evaluate((el) => el.clientWidth / el.clientHeight);
  expect(ratio).toBeCloseTo(640 / 960, 2);
});

test('intent preload is cancelled on leave/scroll and a click joins a single in-flight native request', async ({ page }) => {
  const originalRequests: string[] = [];
  let release: (() => void) | undefined;
  await page.route(/^https?:\/\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === original) {
      originalRequests.push(route.request().resourceType());
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return route.fulfill({ contentType: 'image/svg+xml', body: svg(1280, 1920) });
    }
    if (path.includes('/examples/thumbs/')) return route.fulfill({ contentType: 'image/svg+xml', body: svg(640, 960) });
    if (route.request().resourceType() === 'image' || path.includes('/api/live2d')) return route.abort();
    return route.continue();
  });
  await openGallery(page, '/image-style-prompt-gallery/examples?grouped=false');
  const trigger = page.locator(`[data-gallery-original="${original}"]`);
  await expect(trigger.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await expect(page.locator('astro-island[component-url*="ImageLightbox"]')).not.toHaveAttribute('ssr');
  await trigger.dispatchEvent('pointerover', { pointerType: 'mouse' });
  await trigger.dispatchEvent('pointerout', { pointerType: 'mouse' });
  await page.waitForTimeout(500);
  expect(originalRequests).toEqual([]);
  await trigger.dispatchEvent('pointerover', { pointerType: 'mouse' });
  await page.evaluate(() => document.dispatchEvent(new Event('scroll')));
  await page.waitForTimeout(500);
  expect(originalRequests).toEqual([]);
  await trigger.focus();
  await expect.poll(() => originalRequests.length).toBe(1);
  await trigger.press('Enter');
  await expect(page.getByRole('dialog').getByRole('progressbar')).toBeVisible();
  release?.();
  await expect(page.getByRole('dialog').getByRole('progressbar')).toHaveCount(0);
  expect(originalRequests).toEqual(['image']);
});

test('data saver does not preload full images on hover', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true } }));
  let requests = 0;
  await page.route(/^https?:\/\//, (route) => {
    if (route.request().url().includes('/examples/thumbs/')) {
      return route.fulfill({ contentType: 'image/svg+xml', body: svg(640, 960) });
    }
    if (route.request().url().includes('/examples/images/')) requests++;
    if (route.request().resourceType() === 'image' || route.request().url().includes('/api/live2d')) return route.abort();
    return route.continue();
  });
  await openGallery(page, '/image-style-prompt-gallery/examples?grouped=false');
  await expect(page.locator('astro-island[component-url*="ImageLightbox"]')).not.toHaveAttribute('ssr');
  await page.locator(`[data-gallery-original="${original}"]`).dispatchEvent('pointerover', { pointerType: 'mouse' });
  await page.waitForTimeout(500);
  expect(requests).toBe(0);
});

for (const path of [
  '/image-style-prompt-gallery/index',
  '/image-style-prompt-gallery',
  '/image-style-prompt-gallery/examples',
  '/image-style-prompt-gallery/examples?grouped=false',
  '/image-style-prompt-gallery/2026-09-23-35dc5191ccad',
]) {
  test(`${path}: only deliberate zoom intent preloads an original`, async ({ page }) => {
    const source =
      path.includes('examples') || path.includes('2026-09-23') ? original : '/api/style-gallery/image/source/35dc5191ccad.png';
    let requests = 0;
    await page.route(/^https?:\/\//, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === source) requests++;
      if (url.pathname.startsWith('/api/style-gallery/image/'))
        return route.fulfill({ contentType: 'image/svg+xml', body: svg(640, 960) });
      if (route.request().resourceType() === 'image' || url.pathname.includes('/api/live2d')) return route.abort();
      return route.continue();
    });
    await openGallery(page, path);
    const zoom = page.locator(`[data-gallery-original="${source}"]`).first();
    await expect(zoom.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
    await zoom.scrollIntoViewIfNeeded();
    await page.waitForTimeout(220);
    // Hovering the large image is not a request for full-resolution bytes.
    await zoom.locator('..').locator('img').first().dispatchEvent('pointerover', { pointerType: 'mouse' });
    await page.waitForTimeout(500);
    expect(requests).toBe(0);
    await zoom.dispatchEvent('pointerover', { pointerType: 'touch' });
    await page.waitForTimeout(500);
    expect(requests).toBe(0);
    // A card scrolling beneath a stationary pointer must not restart the dwell timer.
    await page.evaluate(() => document.dispatchEvent(new Event('scroll')));
    await zoom.dispatchEvent('pointerover', { pointerType: 'mouse' });
    await page.waitForTimeout(500);
    expect(requests).toBe(0);
    await zoom.dispatchEvent('pointerover', { pointerType: 'mouse' });
    await page.waitForTimeout(500);
    expect(requests).toBe(0);
    // Real movement after scrolling can establish a fresh intent without re-entering.
    await zoom.dispatchEvent('pointermove', { pointerType: 'mouse', movementX: 2 });
    await expect.poll(() => requests).toBe(1);
    await zoom.evaluate((el: HTMLButtonElement) => el.click());
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('progressbar')).toHaveCount(0);
    expect(requests).toBe(1);
  });
}

test('an HTTP success with corrupt image bytes is not retained across viewer opens', async ({ page }) => {
  let requests = 0;
  await page.route(/^https?:\/\//, (route) => {
    if (route.request().url().endsWith('/decode-retry.svg')) {
      requests++;
      return route.fulfill({
        contentType: 'image/svg+xml',
        headers: { 'cache-control': 'no-store' },
        body: requests === 1 ? 'corrupt image' : svg(640, 960),
      });
    }
    if (route.request().resourceType() === 'image' || route.request().url().includes('/api/live2d')) return route.abort();
    return route.continue();
  });
  await openGallery(page, '/image-style-prompt-gallery');
  const open = () =>
    page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('open-image-lightbox', {
          detail: { images: [{ src: '/decode-retry.svg', alt: 'Retry image' }], currentIndex: 0 },
        }),
      ),
    );
  await open();
  const dialog = page.getByRole('dialog');
  await expect.poll(() => requests).toBe(1);
  await expect(dialog.getByRole('progressbar')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await open();
  await expect
    .poll(() => dialog.getByAltText('Retry image').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(640);
  expect(requests).toBe(2);
});
