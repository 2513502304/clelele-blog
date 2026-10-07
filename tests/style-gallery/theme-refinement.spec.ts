import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { APPEARANCES } from '../../src/components/theme/appearance';

const detail = '/image-style-prompt-gallery/2026-09-23-35dc5191ccad';
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (r) => {
    if (r.request().resourceType() === 'image')
      return r.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"><rect width="640" height="960" fill="#adddd1"/></svg>',
      });
    if (r.request().url().includes('/api/live2d')) return r.abort();
    return r.continue();
  });
});

test('three-row notes scroll independently by wheel and keyboard in both layouts', async ({ page }) => {
  await page.goto(detail, { waitUntil: 'domcontentloaded' });
  const note = page.locator('[data-example-note]').first();
  await expect(note.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  const toggle = page.getByRole('button', { name: '瀑布流', exact: true });
  for (const layout of ['masonry', 'grid']) {
    await expect(page.locator('[data-gallery-layout]')).toHaveAttribute('data-gallery-layout', layout);
    await note.scrollIntoViewIfNeeded();
    await expect(note).toHaveCSS('overflow-y', 'auto');
    expect(await note.evaluate((el) => el.clientHeight / parseFloat(getComputedStyle(el).lineHeight))).toBeCloseTo(3, 1);
    // Hover may finish bringing the new grid layout into view before the wheel gesture.
    await note.hover();
    const scroll = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => note.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
    await note.focus();
    await page.keyboard.press('End');
    await expect.poll(() => note.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
    await page.keyboard.press('Home');
    await expect.poll(() => note.evaluate((el) => el.scrollTop)).toBe(0);
    if (layout === 'masonry') await toggle.click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--reading-size', '130%');
  });
  expect(await note.evaluate((el) => el.clientHeight / parseFloat(getComputedStyle(el).lineHeight))).toBeCloseTo(3, 1);
  await note.focus();
  await page.keyboard.press('End');
  await expect.poll(() => note.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
});

test('masonry and grouping remain visibly selected in every palette and mode', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/image-style-prompt-gallery/examples', { waitUntil: 'domcontentloaded' });
  const toggle = page.getByRole('button', { name: '瀑布流', exact: true });
  await expect(toggle.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important}' });
  for (const dark of [false, true])
    for (const { id } of APPEARANCES) {
      await page.evaluate(
        ({ id, dark }) => {
          document.documentElement.dataset.appearance = id;
          document.documentElement.classList.toggle('dark', dark);
        },
        { id, dark },
      );
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      const selected = await toggle.evaluate((el) => {
        const css = getComputedStyle(el);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas unavailable');
        const luminance = (color: string) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((c) => {
            const v = c / 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          });
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const a = luminance(css.color),
          b = luminance(css.backgroundColor);
        return {
          color: css.color,
          background: css.backgroundColor,
          border: css.borderColor,
          contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        };
      });
      expect(selected.contrast, `${id} dark=${dark}`).toBeGreaterThanOrEqual(4.5);
      await expect(toggle.locator('.gallery-toggle-status')).toHaveText('✓');
      const grouped = page.locator('.gallery-view-toggle').nth(1);
      await expect(grouped).toHaveAttribute('aria-pressed', 'true');
      await expect(grouped).toHaveCSS('background-color', selected.background);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(toggle.locator('.gallery-toggle-status')).toBeEmpty();
      await expect(toggle).not.toHaveCSS('border-color', selected.border);
      await expect(toggle).not.toHaveCSS('color', selected.color);
      await toggle.click();
    }
  await page.getByRole('button', { name: '同源折叠', exact: true }).click();
  await expect(page.locator('.gallery-view-toggle').nth(1)).toHaveAttribute('aria-pressed', 'false');
});

test('the reading edge fades through intermediate pixels, without a hard rectangle', async ({ page }, testInfo) => {
  // This samples a static surface; decorative petals must not contaminate its pixel gradient.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(detail, { waitUntil: 'domcontentloaded' });
  const surface = page.locator('.page-reading-layout');
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important}' });
  for (const dark of [false, true]) {
    await page.evaluate((dark) => {
      document.documentElement.dataset.appearance = 'blueprint';
      document.documentElement.classList.toggle('dark', dark);
    }, dark);
    await surface.evaluate((el) => {
      window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 110);
    });
    const box = await surface.boundingBox();
    if (!box) throw new Error('No reading surface');
    const reference = await page.locator('.gallery-reference-frame').boundingBox();
    const prompt = await page.locator('.gallery-prompt-sheet').boundingBox();
    if (!reference || !prompt) throw new Error('No reading columns');
    // Sample the empty gutter between reading columns, from the cover edge down
    // past the breadcrumb, rather than merely asserting a gradient declaration.
    const buffer = await page.screenshot({
      clip: { x: Math.floor((reference.x + reference.width + prompt.x) / 2), y: Math.round(box.y - 2), width: 1, height: 260 },
      scale: 'css',
      animations: 'disabled',
    });
    const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (y: number) => Array.from(data.subarray(y * info.channels, (y + 1) * info.channels));
    const delta = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    // Allow the same three-level raster rounding budget used for adjacent pixels below.
    expect(delta(pixel(0), pixel(3))).toBeLessThanOrEqual(3);
    expect(delta(pixel(0), pixel(259))).toBeGreaterThan(0);
    // Allow small raster quantization/shadow steps, but not a visible surface seam.
    for (let y = 1; y < 260; y++) expect(delta(pixel(y - 1), pixel(y))).toBeLessThanOrEqual(3);
    await expect(page.locator('.gallery-reference-frame img').first()).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath(`reading-${dark ? 'dark' : 'light'}.png`), animations: 'disabled' });
  }
});
