import { expect, test } from '@playwright/test';

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="pink"/></svg>';

test('cold downloads show byte progress, cached images skip loading, and failed streams fall back to native images', async ({
  page,
}) => {
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'image' || route.request().url().includes('/api/live2d')
      ? route.abort()
      : route.continue(),
  );
  await page.goto('/image-style-prompt-gallery');
  await expect.poll(() => page.locator('[data-gallery-layout]').evaluate((element) => element.style.height)).not.toBe('');
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/budget-fallback.svg')) {
        return new Response(
          new ReadableStream({
            cancel() {
              document.documentElement.dataset.budgetCancelled = 'true';
            },
          }),
          {
            headers: { 'content-type': 'image/svg+xml', 'content-length': String(65 * 1024 * 1024) },
          },
        );
      }
      if (!url.includes('/progress-test.svg')) return originalFetch(input, init);
      init?.signal?.addEventListener('abort', () => {
        document.documentElement.dataset.progressAborted = 'true';
      });
      const bytes = new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="pink"/></svg>',
      );
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, 40));
            setTimeout(() => {
              controller.enqueue(bytes.slice(40));
              controller.close();
            }, 2500);
          },
        }),
        { headers: { 'content-type': 'image/svg+xml', 'content-length': String(bytes.length) } },
      );
    };
  });
  const open = (src: string) =>
    page.evaluate(
      (src) =>
        window.dispatchEvent(
          new CustomEvent('open-image-lightbox', { detail: { images: [{ src, alt: 'Progress test' }], currentIndex: 0 } }),
        ),
      src,
    );
  await page.route('**/progress-test.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: svg }));
  await open('/progress-test.svg');
  const progress = page.getByRole('progressbar');
  await expect(progress).toHaveAttribute(
    'aria-valuenow',
    String(Math.floor((40 / new TextEncoder().encode(svg).length) * 100)),
  );
  await expect(page.getByText(/MB \/ .* MB/)).toBeVisible();
  await page.screenshot({ path: '/tmp/gallery45-progress.png' });
  await expect(progress).toHaveCount(0);
  await page.keyboard.press('Escape');
  await open('/progress-test.svg');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(progress).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.route('**/native-fallback.svg', (route) =>
    route.request().resourceType() === 'fetch' ? route.abort() : route.fulfill({ contentType: 'image/svg+xml', body: svg }),
  );
  await open('/native-fallback.svg');
  await expect(page.getByRole('dialog').getByAltText('Progress test')).toBeVisible();
  await expect(progress).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    delete document.documentElement.dataset.progressAborted;
  });
  await open('/progress-test.svg?pending=true');
  await expect(progress).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-progress-aborted', 'true');
  await open('/native-fallback.svg');
  await expect(progress).toHaveCount(0);
  await expect(page.getByRole('dialog').getByAltText('Progress test')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.route('**/budget-fallback.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: svg }));
  await open('/budget-fallback.svg');
  await expect(page.locator('html')).toHaveAttribute('data-budget-cancelled', 'true');
  await expect(progress).toHaveCount(0);
  await expect(page.getByRole('dialog').getByAltText('Progress test')).toBeVisible();
});
