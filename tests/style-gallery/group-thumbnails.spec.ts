import { expect, test } from '@playwright/test';

const previewSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"><rect width="640" height="960" fill="pink"/></svg>';

test('folded cards request thumbnails only and reuse the loaded preview while the original downloads', async ({ page }) => {
  const originals: string[] = [];
  const previews: string[] = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('/examples/thumbs/')) {
      previews.push(url);
      return route.fulfill({ contentType: 'image/svg+xml', body: previewSvg });
    }
    if (url.includes('/examples/images/')) {
      originals.push(url);
      return route.abort();
    }
    if (route.request().resourceType() === 'image' || url.includes('/api/live2d')) return route.abort();
    return route.continue();
  });
  await page.goto('/image-style-prompt-gallery/examples');
  const stack = page.locator('.gallery-source-stack').first();
  await expect
    .poll(() =>
      stack
        .locator('img')
        .evaluateAll((images) =>
          images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0),
        ),
    )
    .toBe(true);
  await expect.poll(() => page.locator('[data-gallery-layout]').evaluate((element) => element.style.height)).not.toBe('');
  expect(originals).toHaveLength(0);
  const preview = await stack.locator('[data-layer="0"] img').getAttribute('src');
  expect(preview).toContain('/examples/thumbs/');
  // Hold the real original path at the transport boundary: preview must stay visible
  // before a completed full image can be decoded, including when signing finishes.
  await page.evaluate((svg) => {
    const fetchOriginal = window.fetch;
    window.fetch = async (input, init) => {
      if (!String(input).includes('/examples/images/')) return fetchOriginal(input, init);
      document.documentElement.dataset.fullImageRequested = 'true';
      const bytes = new TextEncoder().encode(svg);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, 30));
            (window as unknown as { finishOriginal: () => void }).finishOriginal = () => {
              controller.enqueue(bytes.slice(30));
              controller.close();
            };
          },
        }),
        { headers: { 'content-type': 'image/svg+xml', 'content-length': String(bytes.length) } },
      );
    };
  }, previewSvg);
  await stack.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-full-image-requested', 'true');
  const reused = dialog.locator('img').filter({ visible: true });
  await expect
    .poll(() =>
      reused.evaluateAll(
        (images, src) =>
          images.some(
            (image) =>
              image.getAttribute('src') === src &&
              image instanceof HTMLImageElement &&
              image.complete &&
              image.naturalWidth > 0,
          ),
        preview,
      ),
    )
    .toBe(true);
  await expect(dialog.getByRole('progressbar')).toBeVisible();
  await page.screenshot({ path: '/tmp/gallery-thumbnail-lightbox-preview.png' });
  await page.evaluate(() => (window as unknown as { finishOriginal: () => void }).finishOriginal());
  await expect(dialog.getByRole('progressbar')).toHaveCount(0);
  await expect
    .poll(() =>
      dialog
        .locator('img[src^="blob:"]')
        .evaluateAll((images) =>
          images.some((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0),
        ),
    )
    .toBe(true);
});

test('a landscape thumbnail reserves the original lightbox size before the full image arrives', async ({ page }) => {
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'image' || route.request().url().includes('/api/live2d')
      ? route.abort()
      : route.continue(),
  );
  await page.goto('/image-style-prompt-gallery/examples', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('[data-gallery-layout]').evaluate((element) => element.style.height)).not.toBe('');
  await page.evaluate(() => {
    const preview =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"><rect width="640" height="960" fill="pink"/></svg>',
      );
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      if (!String(input).includes('landscape-original.svg')) return originalFetch(input, init);
      const bytes = new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="pink"/></svg>',
      );
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, 20));
            (window as unknown as { finishLandscape: () => void }).finishLandscape = () => {
              controller.enqueue(bytes.slice(20));
              controller.close();
            };
          },
        }),
        { headers: { 'content-type': 'image/svg+xml', 'content-length': String(bytes.length) } },
      );
    };
    window.dispatchEvent(
      new CustomEvent('open-image-lightbox', {
        detail: {
          images: [
            {
              src: '/landscape-original.svg',
              previewSrc: preview,
              dimensions: { width: 1600, height: 900 },
              alt: 'Landscape geometry',
            },
          ],
          currentIndex: 0,
        },
      }),
    );
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('progressbar')).toBeVisible();
  const preview = dialog.locator('img[src^="data:"]');
  const bounds = await preview.evaluate((element) => ({ width: element.clientWidth, height: element.clientHeight }));
  expect(bounds.width).toBeGreaterThan(640);
  expect(bounds.width / bounds.height).toBeCloseTo(1600 / 900, 2);
  await page.evaluate(() => (window as unknown as { finishLandscape: () => void }).finishLandscape());
  await expect(dialog.getByRole('progressbar')).toHaveCount(0);
  const fullBounds = await dialog
    .locator('img[src^="blob:"]')
    .evaluate((element) => ({ width: element.clientWidth, height: element.clientHeight }));
  expect(fullBounds).toEqual(bounds);
});
