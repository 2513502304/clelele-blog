import { expect, test } from '@playwright/test';
import { SCENERY_RULES } from '../../src/components/theme/scenery-preferences';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="700"><rect width="1800" height="700" fill="#dc5740"/></svg>',
        })
      : route.continue(),
  );
  await page.route('**/api/live2d**', (route) => route.abort());
});

test('every setting has contextual help; hover and Escape do not change preferences or close the panel', async ({ page }) => {
  await page.goto('/about');
  await page.locator('[data-appearance-toggle]').click();
  const panel = page.locator('.appearance-panel');
  const initial = await page.evaluate(() => JSON.stringify(window.__sceneryPreferences));
  const keys = new Set<string>();
  for (const tab of ['外观预设', '阅读与界面', '横幅', '氛围']) {
    await panel.getByRole('button', { name: tab, exact: true }).click();
    while (await panel.locator('details:not([open]) > summary').count()) {
      await panel.locator('details:not([open]) > summary').first().click();
    }
    for (const key of await panel
      .locator('[data-setting-help]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-setting-help') || '')))
      keys.add(key);
  }
  for (const key of [
    ...Object.keys(SCENERY_RULES),
    'palette',
    'looks',
    'ambientLooks',
    'fontSize',
    'lineHeight',
    'font',
    'readingDensity',
    'corners',
    'transparency',
    'motion',
  ])
    expect(keys.has(key), key).toBe(true);
  await panel.getByRole('button', { name: '横幅', exact: true }).click();
  const help = panel.locator('[data-setting-help="lightBlur"]');
  await expect(help).toHaveAccessibleName('说明: 柔化程度');
  await help.hover();
  const popup = page.locator('.setting-help-popup[role="tooltip"]');
  await expect(popup).toContainText('越大越朦胧');
  await popup.hover();
  await expect(popup).toBeVisible();
  // The portal can extend beyond the panel's clipped scrolling region.
  expect(await popup.evaluate((el) => el.closest('.appearance-scroll'))).toBeNull();
  await page.mouse.move(0, 0);
  await help.focus();
  await expect(popup).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(panel).toBeVisible();
  await help.blur();
  await help.focus();
  await expect(popup).toBeVisible();
  const beforeMove = await panel.boundingBox();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(popup).toHaveCount(0);
  await expect.poll(async () => (await panel.boundingBox())?.x).toBeLessThan(beforeMove?.x ?? 0);
  expect(await page.evaluate(() => JSON.stringify(window.__sceneryPreferences))).toBe(initial);
});

for (const [locale, tab, phrase] of [
  ['en', 'Reading & layout', 'Scales site text'],
  ['ja', '文字と表示', '全体の文字'],
] as const) {
  test(`help supports ${locale}, touch-sized screens and dismissal on panel scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${locale}/about`);
    await page.locator('[data-appearance-toggle]').click();
    const panel = page.locator('.appearance-panel');
    await panel.getByRole('button', { name: tab, exact: true }).click();
    await expect(panel.locator('[data-setting-help="fontSize"]')).toHaveAccessibleName(
      locale === 'en' ? 'Help: Text size' : '説明: 文字サイズ',
    );
    await panel.locator('[data-setting-help="fontSize"]').click();
    const popup = page.locator('.setting-help-popup[role="tooltip"]');
    await expect(popup).toContainText(phrase);
    const box = await popup.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    await panel.locator('.appearance-scroll').evaluate((el) => {
      el.scrollTop = 200;
    });
    await expect(popup).toHaveCount(0);
    await expect(panel).toBeVisible();
  });
}
