import { expect, type Locator, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Theme checks need decoded images, not signed fixture URLs that intentionally cannot reach HF.
  // Astro waits for the destination banner before swapping pages; fulfill it locally on both engines.
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'image')
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"><rect width="640" height="960" fill="#adddd1"/></svg>',
      });
    return route.continue();
  });
});

async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element has no visible bounds');
  return box;
}

test('appearance palettes persist, preserve layout and support a draggable folding reader panel', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'astro-dev-toolbar { display: none !important; }';
      document.head.append(style);
    });
  });
  await page.route('**/api/live2d**', (route) => route.abort());
  await page.goto('/image-style-prompt-gallery/examples', { waitUntil: 'domcontentloaded' });
  const card = page.locator('.gallery-source-stack').first();
  await expect(card).toBeVisible();
  const width = (await bounds(card)).width;
  const toggle = page.getByRole('button', { name: '主题与阅读', exact: true });
  await toggle.click();
  const panel = page.locator('.appearance-panel');
  await expect(panel).toBeVisible();
  const presets = panel.locator('.appearance-preset');
  await expect(presets).toHaveCount(10);
  for (const name of [
    '花间手记',
    '纸上画廊',
    '林间书屋',
    '海盐来信',
    '紫藤小院',
    '琥珀午后',
    '玫瑰木',
    '铅笔与墨',
    '蓝调印刷',
  ]) {
    await panel.getByRole('button', { name, exact: true }).click();
    await expect(panel.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).not.toHaveClass(/appearance-transition/);
    expect((await bounds(card)).width).toBeCloseTo(width, 0);
  }
  await panel.getByRole('button', { name: '纸上画廊', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'paper');
  await expect(page.locator('html')).not.toHaveClass(/appearance-transition/);
  await page.screenshot({ path: '/tmp/theme-paper.png' });
  await panel.getByRole('button', { name: /Aa\s*舒适/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'comfort');
  const before = await bounds(panel);
  // Drag from a swatch; this must not activate the palette under the release.
  const target = await panel.getByRole('button', { name: '海盐来信', exact: true }).boundingBox();
  if (!target) throw new Error('No swatch');
  await page.mouse.move(target.x + 20, target.y + 20);
  await page.mouse.down();
  await page.mouse.move(target.x - 110, target.y - 20, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await bounds(panel)).x).toBeLessThan(before.x - 80);
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'paper');
  await panel.getByRole('button', { name: '折叠主题设置' }).click();
  await expect(panel).toHaveAttribute('data-expanded', 'false');
  await expect.poll(async () => (await bounds(panel)).height).toBeLessThan(100);
  await panel.getByRole('button', { name: '展开主题设置' }).click();
  await expect(panel).toHaveAttribute('data-expanded', 'true');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'paper');
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'comfort');
  await page.setViewportSize({ width: 390, height: 844 });
  await toggle.click();
  await expect(panel).toBeVisible();
  const panelBounds = await bounds(panel);
  expect(panelBounds.x).toBeGreaterThanOrEqual(0);
  expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(390);
  const scroll = panel.locator('.appearance-scroll');
  await scroll.hover();
  await page.mouse.wheel(0, 180);
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({ path: '/tmp/theme-mobile.png' });
  await panel.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'original');
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'standard');
  await panel.getByRole('button', { name: '关闭主题设置' }).click();
  await expect(panel).toHaveCount(0);
  await expect(toggle).toBeFocused();
});

test('reduced motion, dark mode, storage changes and Astro navigation keep appearance preferences', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'astro-dev-toolbar { display: none !important; }';
      document.head.append(style);
    });
  });
  await page.route('**/api/live2d**', (route) => route.abort());
  await page.goto('/image-style-prompt-gallery/examples', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  await page.getByRole('button', { name: '紫藤小院', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'lavender');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('html')).not.toHaveClass(/appearance-transition/);
  await page.screenshot({ path: '/tmp/theme-dark.png' });
  await page.evaluate(() => {
    localStorage.setItem('appearance', 'sage');
    window.dispatchEvent(new StorageEvent('storage', { key: 'appearance', newValue: 'sage' }));
  });
  await expect(page.getByRole('button', { name: '林间书屋', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '关闭主题设置' }).click();
  await page.locator('a[href="/weekly"]').first().click();
  await expect(page).toHaveURL(/\/weekly$/);
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'sage');
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('keyboard opening focuses the panel and rapid preset/size changes keep the latest intent', async ({ page }) => {
  await page.goto('/image-style-prompt-gallery/examples', { waitUntil: 'domcontentloaded' });
  const toggle = page.getByRole('button', { name: '主题与阅读', exact: true });
  await expect(toggle.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '折叠主题设置' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.appearance-panel')).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Enter');
  // Hold the snapshot callback to reproduce a second control click before the palette reaches the DOM.
  await page.evaluate(() => {
    const updates: Array<() => void> = [];
    Object.assign(window, {
      finishAppearanceUpdates: () => {
        for (const update of updates) update();
      },
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (update: () => void) => {
        updates.push(update);
        return { skipTransition() {}, finished: new Promise(() => {}) };
      },
    });
  });
  await page.getByRole('button', { name: '纸上画廊', exact: true }).click();
  await page.getByRole('button', { name: /Aa\s*舒适/ }).click();
  await page.evaluate(() => (window as unknown as { finishAppearanceUpdates(): void }).finishAppearanceUpdates());
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'paper');
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'comfort');
});

test('primary foreground meets normal-text contrast in every light and dark palette', async ({ page }) => {
  await page.goto('/image-style-prompt-gallery/examples', { waitUntil: 'domcontentloaded' });
  const results = await page.evaluate(() => {
    const root = document.documentElement;
    const probe = document.createElement('span');
    probe.style.cssText = 'background: hsl(var(--primary)); color: hsl(var(--primary-foreground));';
    document.body.append(probe);
    const luminance = (rgb: string) => {
      const channels = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
        const c = Number(value) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    return [false, true].flatMap((dark) => {
      root.classList.toggle('dark', dark);
      return ['sakura', 'paper', 'sage', 'ocean', 'lavender', 'amber', 'rosewood', 'graphite', 'blueprint'].map((palette) => {
        root.dataset.appearance = palette;
        const style = getComputedStyle(probe);
        const values = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => a - b);
        return { palette, dark, contrast: (values[1] + 0.05) / (values[0] + 0.05) };
      });
    });
  });
  for (const result of results) expect(result.contrast, JSON.stringify(result)).toBeGreaterThanOrEqual(4.5);
});
