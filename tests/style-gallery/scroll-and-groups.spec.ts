import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Delayed media must not be needed for geometry or long-scroll correctness.
  await page.route('**/*', (route) => {
    const request = route.request();
    return request.resourceType() === 'image' || request.url().includes('/api/live2d') ? route.abort() : route.continue();
  });
});

for (const path of ['/image-style-prompt-gallery', '/image-style-prompt-gallery/examples']) {
  test(`${path}: defaults to masonry and preserves scrolling and order through twelve appended batches`, async ({ page }) => {
    await page.goto(path);
    const grid = page.locator('[data-gallery-layout]');
    await expect(grid).toHaveAttribute('data-gallery-layout', 'masonry');
    await expect.poll(() => grid.evaluate((e) => e.style.height)).not.toBe('');
    for (let batch = 0; batch < 12; batch++) {
      const before = await grid.evaluate((element) => {
        window.scrollTo(0, element.getBoundingClientRect().bottom + scrollY - innerHeight - 100);
        return { scroll: scrollY, count: element.children.length };
      });
      await expect.poll(() => grid.locator(':scope > *').count()).toBeGreaterThan(before.count);
      expect(await page.evaluate(() => scrollY)).toBeGreaterThanOrEqual(before.scroll - 2);
    }
    const before = await grid.evaluate((e) =>
      [...e.children].slice(0, 12).map((c) => ({ id: c.id, column: (c as HTMLElement).offsetLeft })),
    );
    await page.getByRole('button', { name: '瀑布流显示', exact: true }).click();
    await expect(grid).toHaveAttribute('data-gallery-layout', 'grid');
    const after = await grid.evaluate((e) =>
      [...e.children].slice(0, 12).map((c) => ({ id: c.id, column: (c as HTMLElement).offsetLeft })),
    );
    expect(after).toEqual(before);
  });
}

test('folding groups deduplicates sources and fans only decorative layers on hover', async ({ page }) => {
  await page.goto('/image-style-prompt-gallery/examples');
  await page.getByRole('button', { name: '同源折叠', exact: true }).click();
  const cards = page.locator('[data-gallery-layout] > figure');
  await expect(cards.first()).toHaveAttribute('data-source-stack', 'true');
  const slugs = await cards.evaluateAll((es) => es.map((e) => e.getAttribute('data-source-slug')));
  expect(new Set(slugs).size).toBe(slugs.length);
  const stack = cards.first().locator('.gallery-source-stack');
  await stack.scrollIntoViewIfNeeded();
  const before = await stack.boundingBox();
  const layer = stack.locator('.gallery-stack-layer').first();
  const transform = await layer.evaluate((e) => getComputedStyle(e).transform);
  await stack.hover();
  await expect.poll(() => layer.evaluate((e) => getComputedStyle(e).transform)).not.toBe(transform);
  expect(await stack.boundingBox()).toEqual(before);
  await cards
    .first()
    .getByRole('button', { name: /展开图片/ })
    .click();
  await expect(cards.first()).not.toHaveAttribute('data-source-stack');
  await cards.first().getByRole('button', { name: '折叠同源图片' }).click();
  await expect(cards.first()).toHaveAttribute('data-source-stack', 'true');
});
