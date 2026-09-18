import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Delayed media must not be needed for geometry or long-scroll correctness.
  await page.route('**/*', (route) => {
    const request = route.request();
    return request.resourceType() === 'image' || request.url().includes('/api/live2d') ? route.abort() : route.continue();
  });
});

for (const path of ['/image-style-prompt-gallery', '/image-style-prompt-gallery/examples?grouped=false']) {
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
    await page.getByRole('button', { name: '瀑布流', exact: true }).click();
    await expect(grid).toHaveAttribute('data-gallery-layout', 'grid');
    const after = await grid.evaluate((e) =>
      [...e.children].slice(0, 12).map((c) => ({ id: c.id, column: (c as HTMLElement).offsetLeft })),
    );
    expect(after).toEqual(before);
  });
}

test('folding groups deduplicates sources and fans only decorative layers on hover', async ({ page }) => {
  await page.goto('/image-style-prompt-gallery/examples');
  await expect(page.getByRole('button', { name: '同源折叠', exact: true })).toHaveAttribute('aria-pressed', 'true');
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
  await stack.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
  expect(await stack.boundingBox()).toEqual(before);
  expect(
    await stack.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return [...element.querySelectorAll('.gallery-stack-layer')].every((layer) => {
        const card = layer.getBoundingClientRect();
        return card.left >= bounds.left && card.right <= bounds.right && card.top >= bounds.top && card.bottom <= bounds.bottom;
      });
    }),
  ).toBe(true);
  await expect(cards.getByRole('button', { name: /展开图片|折叠同源图片/ })).toHaveCount(0);
  await expect(cards.first().locator('[data-group-likes]')).toBeVisible();
  await page.getByRole('button', { name: '同源折叠', exact: true }).click();
  await expect(cards.first()).not.toHaveAttribute('data-source-stack');
  await page.getByRole('button', { name: '同源折叠', exact: true }).click();
  await expect(cards.first()).toHaveAttribute('data-source-stack', 'true');
});

test('source stacks disable animated transitions for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/image-style-prompt-gallery/examples?grouped=true');
  const stack = page.locator('.gallery-source-stack').first();
  // CSS also applies before hydration; assert the visible behavior rather than Motion's initial hook value.
  await expect(stack).toBeVisible();
  await stack.hover();
  expect(
    await stack
      .locator('.gallery-stack-layer')
      .first()
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe('0s');
});

test('group totals reflect a member like in the lightbox without writing to the real account', async ({ page }) => {
  let updatedCount = 0;
  await page.route('**/api/style-gallery/likes', (route) =>
    route.fulfill({
      json:
        route.request().method() === 'PUT'
          ? { liked: true, likeCount: updatedCount }
          : { authEnabled: true, viewer: { id: 'test-viewer' }, likedExampleIds: [] },
    }),
  );
  await page.goto('/image-style-prompt-gallery/examples');
  const first = page.locator('[data-gallery-layout] > figure').first();
  await expect.poll(() => page.locator('[data-gallery-layout]').evaluate((e) => e.style.height)).not.toBe('');
  const initial = Number(await first.locator('[data-group-likes]').getAttribute('data-group-likes'));
  await first.locator('.gallery-source-stack').click();
  const like = page.getByRole('dialog').getByRole('button', { name: /^点赞:/ });
  await expect(like).toBeEnabled();
  updatedCount = Number((await like.getAttribute('aria-label'))?.split(':').at(-1)) + 1;
  await like.click();
  await expect(first.locator('[data-group-likes]')).toHaveAttribute('data-group-likes', String(initial + 1));
  await page.keyboard.press('Escape');
});
