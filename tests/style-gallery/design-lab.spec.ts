import { expect, test } from '@playwright/test';

test('four proposals switch independently, filter images, preview artwork and fit mobile', async ({ page }) => {
  await page.route('**/api/site-assets/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#db9"/></svg>',
    }),
  );
  await page.goto('/design-lab', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.querySelector('astro-dev-toolbar')?.remove());
  await page.locator('.collection').scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    await Promise.all([...document.images].map((image) => image.decode().catch(() => {})));
  });
  await page.evaluate(() => scrollTo(0, 0));
  for (const theme of ['sakura', 'atelier', 'folio', 'cinema']) {
    await page.locator(`[data-concept=${theme}]`).click();
    await expect(page.locator('.design-canvas')).toHaveAttribute('data-theme', theme);
    await expect(page).toHaveURL(new RegExp(`theme=${theme}`));
    await page.screenshot({ path: `/tmp/blog-design-${theme}.png`, fullPage: true });
  }
  await page.locator('.site-header [data-view=gallery]').click();
  await expect(page.locator('.hero')).toBeHidden();
  await page.getByRole('searchbox').fill('水彩');
  await expect(page.locator('.image-card:visible')).toHaveCount(1);
  await page.locator('[data-preview]:visible').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: '手机预览', exact: true }).click();
  await expect(page.locator('.design-canvas')).toHaveClass(/mobile-preview/);
  expect(await page.locator('.design-canvas').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const theme of ['sakura', 'atelier', 'folio', 'cinema']) {
    await page.locator(`[data-concept=${theme}]`).click();
    await expect
      .poll(() =>
        page
          .locator('.image-card img')
          .first()
          .evaluate((el) => el.getBoundingClientRect().height),
      )
      .toBeLessThanOrEqual(300);
  }
});
