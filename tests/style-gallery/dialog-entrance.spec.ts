import { expect, test } from '@playwright/test';

for (const mode of ['collection', 'merge']) {
  test(`${mode} opens at stable opacity without remounting the management dialog`, async ({ page }) => {
    await page.route('**/*', (route) => {
      if (route.request().url().includes('/api/live2d')) return route.abort();
      if (route.request().resourceType() === 'image')
        return route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"/>',
        });
      return route.continue();
    });
    await page.goto('/image-style-prompt-gallery', { waitUntil: 'domcontentloaded' });
    const start = page.getByRole('button', { name: mode === 'collection' ? '收藏图片' : '合并卡片', exact: true });
    await expect.poll(() => start.evaluate((el) => !el.closest('astro-island')?.hasAttribute('ssr'))).toBe(true);
    if (mode === 'merge') {
      await start.click();
      await page
        .getByRole('checkbox', { name: /^选择来源 / })
        .nth(0)
        .check();
      await page
        .getByRole('checkbox', { name: /^选择来源 / })
        .nth(1)
        .check();
    }
    const title = mode === 'collection' ? '收藏图片' : '合并两张卡片';
    const trigger =
      mode === 'collection'
        ? start
        : page.locator('[data-gallery-selection-dock]').getByRole('button', { name: '确认两张并比较' });
    const sampling = page.evaluate(async (title) => {
      const frames: { opacity: number; x: number; y: number; sameNode: boolean }[] = [];
      let first: Element | undefined;
      const deadline = performance.now() + 4000;
      while (performance.now() < deadline && frames.length < 24) {
        await new Promise(requestAnimationFrame);
        const dialog = [...document.querySelectorAll('[role="dialog"][data-state="open"]')].find(
          (el) => el.querySelector('h2')?.textContent === title,
        );
        if (!dialog) continue;
        first ??= dialog;
        const rect = dialog.getBoundingClientRect();
        frames.push({ opacity: Number(getComputedStyle(dialog).opacity), x: rect.x, y: rect.y, sameNode: dialog === first });
      }
      return frames;
    }, title);
    await trigger.click();
    const frames = await sampling;
    expect(frames.length).toBeGreaterThan(10);
    expect(frames.every((frame) => frame.opacity === 1 && frame.sameNode)).toBe(true);
    expect(new Set(frames.map((frame) => `${frame.x}:${frame.y}`)).size).toBe(1);
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    await expect(dialog).toBeVisible();
    if (mode === 'merge') page.once('dialog', (confirmation) => confirmation.accept());
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  });
}
