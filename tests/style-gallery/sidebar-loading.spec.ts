import { expect, test } from '@playwright/test';
import { APPEARANCES } from '../../src/components/theme/appearance';

const links = ['GitHub', 'Bilibili', 'YouTube', 'X', 'PixAI', 'Pixiv', 'LinkedIn', 'Email', 'RSS'];
const profile = {
  version: 1,
  revision: 1,
  name: 'clelele',
  signature: '记录技术、AIGC、ACG 与一些个人的兴趣爱好',
  assets: {},
  links: links.map((label, i) => ({
    id: String(i),
    label,
    text: label,
    url: `https://example.com/${i}`,
    icon: 'ri:links-line',
    color: '#557b8b',
  })),
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/live2d**', (route) => route.abort());
  await page.route('**/api/site-profile', (route) => route.fulfill({ json: profile }));
});

test('cabinet groups collections, fits nine links and stays legible across palettes and reading sizes', async ({ page }) => {
  await page.goto('/image-style-prompt-gallery/2026-09-23-35dc5191ccad', { waitUntil: 'domcontentloaded' });
  const sidebar = page.locator('.page-home-sider:visible [data-home-info-container]');
  await expect(sidebar.locator('.sidebar-social-link')).toHaveCount(9);
  await expect(sidebar.locator('[data-sidebar-section="collections"] a')).toHaveText([
    '歌单',
    '追番',
    '手办收藏',
    '风格提示词',
  ]);
  await expect(sidebar.locator('a[aria-current="page"]')).toHaveAttribute('href', '/image-style-prompt-gallery');
  const positions = await sidebar
    .locator('.sidebar-social-link')
    .evaluateAll((nodes) => nodes.map((n) => Math.round(n.getBoundingClientRect().top)));
  expect(new Set(positions).size).toBe(1);
  expect((await sidebar.locator('.sidebar-avatar').boundingBox())?.width).toBe(88);
  for (const preset of APPEARANCES) {
    for (const dark of [false, true]) {
      await page.evaluate(
        ({ id, dark }) => {
          document.documentElement.dataset.appearance = id;
          document.documentElement.classList.toggle('dark', dark);
        },
        { id: preset.id, dark },
      );
      await expect
        .poll(() =>
          sidebar.evaluate((n) => ({
            width: n.clientWidth,
            scroll: n.scrollWidth,
            overflow: Array.from(n.querySelectorAll('*'))
              .filter(
                (el) => el instanceof HTMLElement && el.getBoundingClientRect().right > n.getBoundingClientRect().right + 1,
              )
              .map((el) => el.className)
              .slice(0, 5),
          })),
        )
        .toMatchObject({ overflow: [] });
      const colors = await sidebar.locator('a[aria-current="page"]').evaluate((n) => {
        const css = getComputedStyle(n);
        return [css.backgroundImage, css.color, css.borderColor];
      });
      expect(colors[0]).toContain('gradient');
      expect(colors[1]).not.toBe(colors[2]);
    }
  }
  for (const size of ['85%', '140%']) {
    await page.evaluate((size) => document.documentElement.style.setProperty('--reading-size', size), size);
    await expect
      .poll(() =>
        sidebar.evaluate((n) => ({
          width: n.clientWidth,
          scroll: n.scrollWidth,
          overflow: Array.from(n.querySelectorAll('*'))
            .filter((el) => el instanceof HTMLElement && el.getBoundingClientRect().right > n.getBoundingClientRect().right + 1)
            .map((el) => el.className)
            .slice(0, 5),
        })),
      )
      .toMatchObject({ overflow: [] });
  }
  await page.evaluate(() => document.documentElement.style.removeProperty('--reading-size'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mobile-menu-container').click();
  const drawer = page.locator('#mobile-drawer');
  await expect(drawer).not.toHaveClass(/-translate-x-full/);
  await expect(drawer.locator('.sidebar-social-link')).toHaveCount(9);
  await drawer.locator('[data-collapse-trigger]').click();
  await expect(drawer.locator('[data-collapse-trigger]')).toHaveAttribute('aria-expanded', 'true');
  expect(await drawer.evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
});

test('profile refresh indicator settles on success and failure without hiding existing content', async ({ page }) => {
  for (const status of [200, 503]) {
    let release: (() => void) | undefined;
    await page.route('**/api/site-profile', async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ status, json: profile });
    });
    await page.goto('/image-style-prompt-gallery', { waitUntil: 'domcontentloaded' });
    const identity = page.locator('.page-home-sider:visible .sidebar-identity-copy');
    await expect(identity).toHaveAttribute('aria-busy', 'true');
    await expect(identity).toContainText('clelele');
    await expect.poll(() => !!release).toBe(true);
    release?.();
    await expect(identity).toHaveAttribute('aria-busy', 'false');
  }
});

test('rating batches settle independently and stop spinning for absent or failed scores', async ({ page }) => {
  await page.route('**/api/hpoi?**', (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 25 }, (_, i) => ({
          id: String(i + 1),
          title: `Figure ${i + 1}`,
          imageUrl: null,
          detailUrl: `https://www.hpoi.net/hobby/${i + 1}`,
          score: null,
        })),
        next: null,
        meta: {
          profile: { name: 'Fixture', profileUrl: 'https://www.hpoi.net/user/1', stats: {} },
          warnings: [],
          fetchedAt: '2026-10-05T00:00:00Z',
        },
      },
    }),
  );
  const releases: (() => void)[] = [];
  await page.route('**/api/hpoi/ratings?**', async (route) => {
    const first = !releases.length;
    await new Promise<void>((resolve) => {
      releases.push(resolve);
    });
    await route.fulfill(first ? { json: { '1': '4.77', '2': null } } : { status: 503, json: {} });
  });
  await page.goto('/hpoi', { waitUntil: 'domcontentloaded' });
  const cards = page.locator('[data-gallery-layout] > a');
  await expect(cards.first().locator('[data-hpoi-rating]')).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => releases.length).toBe(1);
  releases[0]();
  await expect.poll(() => releases.length).toBe(2);
  await expect(cards.first()).toContainText('4.77');
  await expect(cards.nth(1).locator('[data-hpoi-rating]')).toHaveText('—');
  await expect(cards.nth(2).locator('[data-hpoi-rating]')).toHaveAttribute('aria-busy', 'false');
  await cards.nth(23).scrollIntoViewIfNeeded();
  await expect(cards).toHaveCount(25);
  await expect(cards.last().locator('[data-hpoi-rating]')).toHaveAttribute('aria-busy', 'true');
  releases[1]();
  await expect(cards.last().locator('[data-hpoi-rating]')).toHaveAttribute('aria-busy', 'false');
  await expect(cards.last().locator('[data-hpoi-rating]')).toHaveText('—');
});

test('on-demand prompt search shows pending state until success or failure', async ({ page }) => {
  for (const status of [200, 503]) {
    let release: (() => void) | undefined;
    await page.route('**/api/style-gallery/prompt-search-index', async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ status, json: {} });
    });
    await page.goto('/image-style-prompt-gallery/index', { waitUntil: 'domcontentloaded' });
    const input = page.locator('section[aria-label="Image style prompt gallery index"] input').first();
    await expect.poll(() => input.evaluate((n) => n.closest('astro-island')?.hasAttribute('ssr'))).toBe(false);
    await input.fill('水彩');
    await expect(input).toHaveAttribute('aria-busy', 'true');
    await expect(input.locator('..').locator('svg.motion-safe\\:animate-spin')).toHaveCount(1);
    await expect.poll(() => !!release).toBe(true);
    release?.();
    await expect(input).toHaveAttribute('aria-busy', 'false');
  }
});
