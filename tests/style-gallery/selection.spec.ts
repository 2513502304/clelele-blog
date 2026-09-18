import { expect, type Locator, type Page, test } from '@playwright/test';

async function setup(page: Page, path: string) {
  await page.route('**/*', (route) => {
    if (route.request().url().includes('/api/live2d')) return route.abort();
    if (route.request().resourceType() === 'image')
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><rect width="480" height="640" fill="#cbbad2"/></svg>',
      });
    return route.continue();
  });
  await page.goto(`/image-style-prompt-gallery${path}`, { waitUntil: 'domcontentloaded' });
  const trigger = page.getByRole('button', { name: '批量标签', exact: true });
  await expect.poll(() => trigger.evaluate((el) => !el.closest('astro-island')?.hasAttribute('ssr'))).toBe(true);
  await trigger.click();
}
async function dragInside(page: Page, card: Locator, modifier?: 'Control' | 'Shift') {
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  if (!box) throw new Error('Missing card geometry');
  const y = Math.max(100, box.y + Math.min(box.height / 2, 150));
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(box.x + 20, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 50, y + 25, { steps: 5 });
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

for (const path of ['', '/index', '/examples']) {
  test(`marquee replaces/appends selections and wheel scrolling retains the gesture: ${path || 'preview'}`, async ({
    page,
  }) => {
    await setup(page, path);
    let accidentalDialogs = 0;
    page.on('dialog', async (dialog) => {
      accidentalDialogs++;
      await dialog.dismiss();
    });
    const cards = page.locator('[data-gallery-selection-id]');
    const selected = page.locator('[data-gallery-selection-id][data-selected="true"]');
    const dock = page.locator('[data-gallery-selection-dock]');
    await dragInside(page, cards.nth(0));
    await expect(selected).toHaveCount(1);
    await dragInside(page, cards.nth(1), 'Control');
    await expect(selected).toHaveCount(2);
    await dragInside(page, cards.nth(2), 'Shift');
    await expect(selected).toHaveCount(3);
    await dragInside(page, cards.nth(1));
    await expect(selected).toHaveCount(1);
    await expect(cards.nth(1)).toHaveAttribute('data-selected', 'true');
    await cards.nth(0).scrollIntoViewIfNeeded();
    const bounds = await cards.nth(0).boundingBox();
    if (!bounds) throw new Error('Missing first card');
    await page.mouse.move(bounds.x + 20, Math.max(bounds.y + bounds.height / 2, 140));
    await page.mouse.down();
    await page.mouse.move(bounds.x + 60, Math.max(bounds.y + bounds.height / 2, 140) + 10);
    const before = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 650);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
    await expect(page.locator('[data-gallery-marquee]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(cards.nth(1)).toHaveAttribute('data-selected', 'true');
    await expect(selected).toHaveCount(1);
    const position = await page.evaluate(() => scrollY);
    await dock.getByRole('button', { name: '清空选择', exact: true }).click();
    await expect(selected).toHaveCount(0);
    expect(await page.evaluate(() => scrollY)).toBe(position);
    await dock.getByRole('button', { name: /^已选择/ }).click();
    await expect(dock.getByRole('button', { name: '清空选择' })).toHaveCount(0);
    await page.screenshot({ path: `/tmp/gallery56-selection-${path.slice(1) || 'preview'}.png` });
    await dock.getByRole('button', { name: /^已选择/ }).click();
    await dock.getByRole('button', { name: '退出多选', exact: true }).click();
    await expect(dock).toHaveCount(0);
    expect(accidentalDialogs).toBe(0);
  });
}

test('merge pair survives filtering and opens automatically with the saved token', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('style-gallery-upload-token', 'test-only'));
  let hashes: string[] = [];
  await setup(page, '');
  await page.route('**/api/style-gallery/merge', (route) => {
    hashes = route.request().postDataJSON().hashes;
    return route.fulfill({ status: 409, body: 'Test preview conflict' });
  });
  await page.getByRole('button', { name: '合并卡片', exact: true }).click();
  const cards = page.locator('[data-gallery-selection-id]');
  const first = await cards.nth(0).getAttribute('data-gallery-selection-id');
  const second = await cards.nth(1).getAttribute('data-gallery-selection-id');
  await cards.nth(0).getByRole('checkbox').check();
  const search = page.locator('input[placeholder^="搜索文本"]');
  await search.fill(second?.slice(-12) ?? 'missing');
  await expect(cards).toHaveCount(1);
  await cards.first().getByRole('checkbox').check();
  const dock = page.locator('[data-gallery-selection-dock]');
  await expect(dock).toContainText(first?.slice(-12) ?? 'missing');
  await dock.getByRole('button', { name: '确认两张并比较' }).click();
  await expect.poll(() => hashes.length).toBe(2);
  expect(hashes.map((hash) => hash.slice(0, 12))).toEqual([first?.slice(-12), second?.slice(-12)]);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('数据已发生变化');
});

test('detail sub-images share marquee, floating platform/download/delete actions and exit', async ({ page }) => {
  await page.route('**/*', (route) => {
    if (route.request().url().includes('/api/live2d')) return route.abort();
    if (route.request().resourceType() === 'image')
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"/>',
      });
    return route.continue();
  });
  await page.goto('/image-style-prompt-gallery/2026-08-18-4a3484f05086');
  const toggle = page.getByRole('button', { name: 'Select images', exact: true });
  await expect.poll(() => toggle.evaluate((el) => !el.closest('astro-island')?.hasAttribute('ssr'))).toBe(true);
  await toggle.click();
  const cards = page.locator('[data-gallery-selection-id]');
  await dragInside(page, cards.first());
  const dock = page.locator('[data-gallery-selection-dock]');
  await expect(dock.getByRole('button', { name: '1 selected', exact: true })).toBeVisible();
  for (const name of ['Download', 'Delete', 'Change platform'])
    await expect(dock.getByRole('button', { name, exact: true })).toBeEnabled();
  await dock.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(page.locator('[data-gallery-selection-id][data-selected="true"]')).toHaveCount(await cards.count());
  await dock.getByRole('button', { name: 'Exit selection', exact: true }).click();
  await expect(dock).toHaveCount(0);
  await expect(page.locator('[data-gallery-selection-id][data-selected="true"]')).toHaveCount(0);
});
