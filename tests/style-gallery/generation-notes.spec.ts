import { expect, type Page, test } from '@playwright/test';

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"><rect width="640" height="960" fill="#adddd1"/></svg>';

async function imagesOnlyFixture(page: Page) {
  await page.route('**/*', (route) => {
    const path = new URL(route.request().url()).pathname;
    // Exercise real page launchers; server metadata comes from the isolated read-only fixture.
    if (path.startsWith('/api/style-gallery/') && route.request().method() !== 'GET') return route.abort();
    if (path.startsWith('/api/live2d')) return route.abort();
    if (path.startsWith('/api/style-gallery/image/') || route.request().resourceType() === 'image')
      return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    return route.continue();
  });
}

async function checkPromptViewer(page: Page, prompt: string) {
  const details = page.locator('[data-image-lightbox] details');
  await expect(details).toBeVisible();
  await expect(details).not.toHaveAttribute('open', '');
  await details.locator('summary').click();
  const full = details.locator('section');
  expect(await full.textContent()).toBe(prompt);
  const pageScroll = await page.evaluate(() => scrollY);
  await full.hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => full.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
  await details.getByRole('button', { name: '复制全部生成图片 prompt', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
}

test('sub-gallery keeps three note rows and opens its complete generation prompt', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await imagesOnlyFixture(page);
  await page.goto('/image-style-prompt-gallery/examples', { waitUntil: 'domcontentloaded' });
  const note = page.locator('[data-example-note]').first();
  await expect(note).toBeVisible();
  const rows = await note.evaluate((el) => {
    const style = getComputedStyle(el);
    return { clamp: style.webkitLineClamp, rows: el.clientHeight / Number.parseFloat(style.lineHeight) };
  });
  expect(rows.clamp).toBe('3');
  expect(rows.rows).toBeCloseTo(3, 1);
  await note.scrollIntoViewIfNeeded();
  const prompt = (await note.textContent()) ?? '';
  expect(prompt).not.toBe('');
  await page.screenshot({ path: '/tmp/gallery-overview-three-rows.png' });
  const card = note.locator('xpath=ancestor::figure');
  await expect(card.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await card.locator('.gallery-source-stack').click();
  await checkPromptViewer(page, prompt);
  await page.screenshot({ path: '/tmp/gallery-overview-generation-note.png' });
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: '展开全部生成图片 prompt', exact: true }).click();
  await expect(page.locator('[data-image-lightbox] details')).toHaveAttribute('open', '');
});

test('detail note is five scrollable rows and opens its complete generation prompt', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await imagesOnlyFixture(page);
  await page.goto('/image-style-prompt-gallery/2026-09-23-35dc5191ccad', { waitUntil: 'domcontentloaded' });
  const note = page.locator('[data-example-note]').first();
  await note.scrollIntoViewIfNeeded();
  const box = await note.evaluate((el) => ({
    rows: el.clientHeight / Number.parseFloat(getComputedStyle(el).lineHeight),
    overflow: el.scrollHeight > el.clientHeight,
  }));
  expect(box.rows).toBeCloseTo(5, 1);
  expect(box.overflow).toBe(true);
  const pageScroll = await page.evaluate(() => scrollY);
  await note.hover();
  await page.mouse.wheel(0, 100);
  await expect.poll(() => note.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
  const prompt = (await note.textContent()) ?? '';
  expect(prompt).not.toBe('');
  await page.screenshot({ path: '/tmp/gallery-detail-five-rows.png' });
  const card = note.locator('xpath=ancestor::figure');
  await expect(card.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await card
    .locator('button')
    .filter({ has: page.locator('img') })
    .first()
    .click();
  await checkPromptViewer(page, prompt);
  await page.screenshot({ path: '/tmp/gallery-detail-generation-note.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = page.locator('[data-image-lightbox] details');
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(bounds?.y).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: '/tmp/gallery-prompt-mobile.png' });
});
