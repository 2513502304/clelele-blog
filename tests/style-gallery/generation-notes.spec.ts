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
  const details = page.locator('[data-generation-reader]');
  await expect(details).toBeVisible();
  await expect(details).toHaveAttribute('data-expanded', 'false');
  await details.locator('.generation-glass-toggle').click();
  const full = details.locator('[data-prompt-text]');
  expect(await full.textContent()).toBe(prompt);
  const pageScroll = await page.evaluate(() => scrollY);
  await full.hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => full.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
  await details.getByRole('button', { name: '复制全部生成图片 prompt', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
}

test('group overview has no misleading note excerpt; each image opens its own complete prompt and platform', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await imagesOnlyFixture(page);
  await page.goto('/image-style-prompt-gallery/examples', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-example-note]')).toHaveCount(0);
  const stack = page.locator('.gallery-source-stack').first();
  await stack.scrollIntoViewIfNeeded();
  await expect(stack.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await stack.click();
  const prompt = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 行：保留角色特征、花瓣、水彩笔触和完整换行。`).join('\n');
  await checkPromptViewer(page, prompt);
  await expect(page.locator('[data-generation-platform]')).toHaveText('PixAI');
  const panel = page.locator('[data-generation-reader]');
  const before = await panel.boundingBox();
  if (!before) throw new Error('Missing prompt reader');
  // Drag from prompt text, not a dedicated handle; releasing must not toggle or copy.
  await page.mouse.move(before.x + 80, before.y + 150);
  await page.mouse.down();
  await page.mouse.move(before.x + 230, before.y + 90, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())?.x).toBeGreaterThan(before.x + 100);
  await expect(panel).toHaveAttribute('data-expanded', 'true');
  // Cancelled mouse drags must not swallow the next touch/pen-generated click.
  for (const ending of ['pointercancel', 'blur', 'outside-release']) {
    await panel.evaluate((el, ending) => {
      const box = el.getBoundingClientRect();
      const start = { bubbles: true, pointerId: 7, pointerType: 'mouse', button: 0, clientX: box.x + 30, clientY: box.y + 30 };
      el.dispatchEvent(new PointerEvent('pointerdown', start));
      window.dispatchEvent(new PointerEvent('pointermove', { ...start, clientX: start.clientX + 20 }));
      window.dispatchEvent(
        ending === 'blur' ? new Event('blur') : new PointerEvent(ending === 'pointercancel' ? ending : 'pointerup', start),
      );
      el.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    }, ending);
    await expect(panel).toHaveAttribute('data-expanded', 'false');
    await panel.locator('.generation-glass-toggle').click();
  }
  await page.screenshot({ path: '/tmp/gallery-glass-reader.png' });
});

test('detail note is five scrollable rows and opens its complete generation prompt', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await imagesOnlyFixture(page);
  await page.goto('/image-style-prompt-gallery/2026-09-23-35dc5191ccad', { waitUntil: 'domcontentloaded' });
  const input = page.locator('[data-example-note-input]');
  await input.fill('多行输入\n'.repeat(100));
  expect(await input.evaluate((el) => ({ height: el.clientHeight, scroll: el.scrollHeight > el.clientHeight }))).toEqual({
    height: 38,
    scroll: true,
  });
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
  const panel = page.locator('[data-generation-reader]');
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(bounds?.y).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: '/tmp/gallery-prompt-mobile.png' });
});

test('platform remains visible without a note, and does not leak the previous image prompt', async ({ page }) => {
  await imagesOnlyFixture(page);
  await page.goto('/image-style-prompt-gallery/examples', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.gallery-source-stack').first().locator('xpath=ancestor::astro-island')).not.toHaveAttribute(
    'ssr',
  );
  await page.evaluate(async () => {
    const path = '/src/store/modal.ts';
    const { openModal } = await import(path);
    openModal('imageLightbox', {
      images: [{ src: '/api/site-assets/home', alt: 'Platform-only output', generationPlatform: 'GPT-Image' }],
      currentIndex: 0,
    });
  });
  await expect(page.locator('[data-generation-platform]')).toHaveText('GPT-Image');
  await expect(page.locator('[data-generation-reader]')).toHaveAttribute('data-expanded', 'false');
  await expect(page.locator('.generation-glass-toggle')).toHaveCount(0);
  expect(await page.locator('[data-generation-reader]').ariaSnapshot()).toContain('GPT-Image');
});
