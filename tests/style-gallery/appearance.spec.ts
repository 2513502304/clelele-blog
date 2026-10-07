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
  await expect(presets).toHaveCount(18);
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
  await panel.getByRole('button', { name: '阅读与界面', exact: true }).click();
  await panel.getByRole('spinbutton', { name: '字号', exact: true }).fill('110');
  await expect(page.locator('html')).toHaveAttribute('data-reading-font-size', '110');
  await panel.getByRole('button', { name: '外观预设', exact: true }).click();
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
  await expect(page.locator('html')).toHaveAttribute('data-reading-font-size', '110');
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
  await expect(page.locator('html')).toHaveAttribute('data-reading-font-size', '100');
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
  await page.getByRole('button', { name: '阅读与界面', exact: true }).click();
  await page.getByRole('spinbutton', { name: '字号', exact: true }).fill('110');
  await page.evaluate(() => (window as unknown as { finishAppearanceUpdates(): void }).finishAppearanceUpdates());
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'paper');
  await expect(page.locator('html')).toHaveAttribute('data-reading-font-size', '110');
});

test('snapshot startup failure still applies and persists the selected palette', async ({ page }) => {
  await page.goto('/image-style-prompt-gallery/examples', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: () => {
        throw new Error('Snapshot unavailable');
      },
    });
  });
  await page.getByRole('button', { name: '纸上画廊', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'paper');
  await expect(page.locator('html')).not.toHaveClass(/appearance-(transition|updated)/);
  await page.getByRole('button', { name: '海盐来信', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'ocean');
  await expect(page.locator('html')).not.toHaveClass(/appearance-(transition|updated)/);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'ocean');
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
      return [
        'sakura',
        'paper',
        'sage',
        'ocean',
        'lavender',
        'amber',
        'rosewood',
        'graphite',
        'blueprint',
        'mint',
        'lemon',
        'peach',
        'ice',
        'mulberry',
        'sand',
        'pistachio',
        'moonlight',
      ].map((palette) => {
        root.dataset.appearance = palette;
        const style = getComputedStyle(probe);
        const values = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => a - b);
        return { palette, dark, contrast: (values[1] + 0.05) / (values[0] + 0.05) };
      });
    });
  });
  for (const result of results) expect(result.contrast, JSON.stringify(result)).toBeGreaterThanOrEqual(4.5);
});

// Real coordinates bypass Playwright's wait-for-animation hit testing, matching rapid user clicks.
test('native transition never swallows a second palette click', async ({ page }) => {
  await page.goto('/image-style-prompt-gallery/examples', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  const paper = await bounds(page.getByRole('button', { name: '纸上画廊', exact: true }));
  const ocean = await bounds(page.getByRole('button', { name: '海盐来信', exact: true }));
  await page.mouse.click(paper.x + paper.width / 2, paper.y + paper.height / 2);
  // Intentionally click inside the animation, not after it completes.
  await page.waitForTimeout(150);
  await page.mouse.click(ocean.x + ocean.width / 2, ocean.y + ocean.height / 2);
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'ocean', { timeout: 500 });
});

test('independent reading controls drag, type, persist and reset without moving the panel', async ({ page }) => {
  await page.goto('/image-style-prompt-gallery/examples', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  await page.getByRole('button', { name: '阅读与界面', exact: true }).click();
  const panel = page.locator('.appearance-panel');
  const before = await bounds(panel);
  const range = page.getByRole('slider', { name: '字号 slider', exact: true });
  const track = await bounds(range);
  await page.mouse.move(track.x + track.width / 3, track.y + 6);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.8, track.y + 6, { steps: 8 });
  expect(Number(await range.inputValue())).toBeGreaterThan(118);
  await page.mouse.up();
  expect((await bounds(panel)).x).toBeCloseTo(before.x, 0);
  const input = page.getByRole('spinbutton', { name: '字号', exact: true });
  await input.fill('');
  await input.pressSequentially('118');
  await input.press('Tab');
  expect(await page.locator('html').evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(17.936, 2);
  await panel.getByLabel('字体', { exact: true }).selectOption('serif');
  await panel.getByLabel('界面密度', { exact: true }).selectOption('compact');
  await panel.getByLabel('卡片圆角', { exact: true }).selectOption('square');
  await panel.getByLabel('控制面板', { exact: true }).selectOption('solid');
  await panel.getByLabel('主题动效', { exact: true }).selectOption('reduced');
  await expect(panel).toHaveCSS('backdrop-filter', 'none');
  await page.reload({ waitUntil: 'domcontentloaded' });
  for (const [key, value] of Object.entries({
    font: 'serif',
    density: 'compact',
    corners: 'square',
    transparency: 'solid',
    motion: 'reduced',
    'font-size': '118',
  })) {
    await expect(page.locator('html')).toHaveAttribute(`data-reading-${key}`, value);
  }
});

test('diagonal reveal has old upper-left and new lower-right pixels after scrolling', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('appearance-scenery', JSON.stringify({ effect: 'none' })));
  await page.goto('/image-style-prompt-gallery/examples', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '主题与阅读', exact: true }).click();
  await page.evaluate(() => scrollTo(0, 480));
  const sharp = (await import('sharp')).default;
  // With ambient light enabled, outer corners reflect the image rather than the
  // palette. Compare actual themed surfaces against both settled page snapshots.
  const colors = async () => {
    const { data, info } = await sharp(await page.screenshot({ scale: 'css' }))
      .raw()
      .toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) =>
      Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
    return [at(200, 80), at(800, 800)];
  };
  const delta = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  await page.getByRole('button', { name: '蓝调印刷', exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/appearance-transition/);
  const blueprint = await colors();
  await page.getByRole('button', { name: '纸上画廊', exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/appearance-transition/);
  const paper = await colors();
  expect(delta(blueprint[0], paper[0])).toBeGreaterThan(8);
  expect(delta(blueprint[1], paper[1])).toBeGreaterThan(8);
  await page.getByRole('button', { name: '蓝调印刷', exact: true }).click();
  await page.waitForFunction(() =>
    document.getAnimations().some((a) => a instanceof CSSAnimation && a.animationName === 'appearance-diagonal'),
  );
  await page.evaluate(() => {
    const animation = document
      .getAnimations()
      .find((a) => a instanceof CSSAnimation && a.animationName === 'appearance-diagonal');
    if (!animation) throw new Error('Missing reveal');
    animation.pause();
    animation.currentTime = 250;
  });
  const during = await colors();
  expect(delta(during[0], paper[0])).toBeLessThanOrEqual(5);
  expect(delta(during[1], blueprint[1])).toBeLessThanOrEqual(5);
  await page.screenshot({ path: '/tmp/appearance-diagonal-verified.png', scale: 'css' });
  // The live settings remain visible and clickable during the paused snapshot.
  await page.getByRole('button', { name: '阅读与界面', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '字号', exact: true })).toBeVisible();
});
