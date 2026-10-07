import { expect, test } from '@playwright/test';
import sharp from 'sharp';

test('expiry preserves a mounted image but a remount uses a valid URL and still recovers from errors', async ({ page }) => {
  const source = '/api/style-gallery/image/source/abcdef123456.jpg';
  const first = `${source}?signature=first`;
  const refreshed = `${source}?signature=fresh`;
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#eebbaa' } })
    .png()
    .toBuffer();
  let signed = first;
  const imageRequests: string[] = [];
  let expiresAt = Date.parse('2026-10-07T12:00:01Z');
  await page.clock.setFixedTime(new Date('2026-10-07T12:00:00Z'));
  await page.route('**/api/style-gallery/images', (route) =>
    route.fulfill({ json: { images: { [source]: signed }, expiresAt } }),
  );
  await page.route('**/*', (route) => {
    if (route.request().resourceType() !== 'image') return route.fallback();
    const url = new URL(route.request().url());
    if (url.pathname === source) imageRequests.push(`${url.pathname}${url.search}`);
    return route.fulfill({ contentType: 'image/png', body: bytes });
  });
  // A minimal entry isolates image behavior and reboots after Vite's first-run
  // dependency optimization reload, without unrelated Astro islands or prefetch.
  await page.route('**/shared-image-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<script type="module">
        import '/@vite/client';
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        const client = await import('/src/lib/style-gallery-image-client.ts');
        const { mountSharedImageHarness } = await import('/tests/style-gallery/shared-image-harness.tsx');
        await client.resolveStyleGalleryImageUrls([${JSON.stringify(source)}]);
        mountSharedImageHarness(${JSON.stringify(source)});
      </script>`,
    }),
  );
  await page.goto('/shared-image-fixture');
  const image = page.locator('#shared-image-harness img');
  await expect(image).toHaveAttribute('src', first);
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(32);

  await page.clock.setFixedTime(new Date('2026-10-07T12:00:02Z'));
  await page.getByRole('button', { name: 'Rerender', exact: true }).click();
  await expect(image).toHaveAttribute('src', first);
  expect(imageRequests).toEqual([first]);

  signed = refreshed;
  expiresAt = Date.parse('2026-10-07T12:01:00Z');
  await page.evaluate(async (source) => {
    const clientPath = '/src/lib/style-gallery-image-client.ts';
    const client = await import(clientPath);
    await client.resolveStyleGalleryImageUrls([source]);
  }, source);
  await page.getByRole('button', { name: 'Remount', exact: true }).click();
  await expect(image).toHaveAttribute('src', refreshed);
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(32);

  await page.clock.setFixedTime(new Date('2026-10-07T12:02:00Z'));
  await page.getByRole('button', { name: 'Rerender', exact: true }).click();
  await expect(image).toHaveAttribute('src', refreshed);
  await page.getByRole('button', { name: 'Remount', exact: true }).click();
  await expect(image).toHaveAttribute('src', source);
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(32);
  expect(imageRequests).toEqual([first, refreshed, source]);

  // A newly signed URL can still be rejected early by its upstream server.
  signed = `${source}?signature=rejected`;
  expiresAt = Date.parse('2026-10-07T12:03:00Z');
  await page.evaluate(async (source) => {
    const clientPath = '/src/lib/style-gallery-image-client.ts';
    const client = await import(clientPath);
    client.resetStyleGalleryImageUrlCache();
    await client.resolveStyleGalleryImageUrls([source]);
  }, source);
  await page.route(`**${signed}`, (route) => route.fulfill({ status: 403, body: 'expired upstream' }));
  const freshRequest = page.waitForRequest((request) => request.url().endsWith(signed));
  await page.getByRole('button', { name: 'Remount', exact: true }).click();
  await freshRequest;
  await expect(image).toHaveAttribute('src', source);
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(32);
});
