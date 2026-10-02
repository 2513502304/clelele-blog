import { expect, test } from '@playwright/test';

async function fixtures(page: import('@playwright/test').Page) {
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"/>',
        })
      : route.continue(),
  );
  await page.route('**/api/live2d**', (route) => route.abort());
}
const bangumiItem = (id: number) => ({
  subject_id: id,
  type: 2,
  tags: [],
  rate: 7,
  subject: { id, name: `Title ${String(100 - id).padStart(3, '0')}`, name_cn: '', score: 8, images: null },
});
const hpoiItem = (id: number) => ({
  id: String(id),
  title: `Figure ${id}`,
  imageUrl: null,
  detailUrl: `https://www.hpoi.net/hobby/${id}`,
  score: '8',
  releaseText: '2026',
  releaseDate: '2026-01-01',
});

test('Bangumi lazily appends unique cards, caches reloads and completes only the active category for sorting', async ({
  page,
}) => {
  await fixtures(page);
  await page.addInitScript(() => {
    const key = 'collection-page-v1:/api/bangumi?subject=anime&offset=0';
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({ expires: Date.now() + 60000, page: null }));
  });
  const requests: string[] = [];
  await page.route('**/api/bangumi?**', (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    const offset = Number(url.searchParams.get('offset'));
    return route.fulfill({
      json: {
        items: Array.from({ length: 24 }, (_, i) => bangumiItem(offset + i + 1)),
        total: 72,
        next: offset < 48 ? `/api/bangumi?subject=anime&offset=${offset + 24}` : null,
      },
    });
  });
  await page.goto('/bangumi', { waitUntil: 'domcontentloaded' });
  const cards = page.locator('[data-gallery-layout] > a');
  await expect(cards).toHaveCount(24);
  expect(requests).toHaveLength(1);
  await expect(page.getByText('分页', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '继续加载', exact: true }).click();
  await expect(cards).toHaveCount(48);
  expect(new Set(await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')))).size).toBe(48);
  await page.locator('#bangumi-sort').scrollIntoViewIfNeeded();
  await page.locator('#bangumi-sort').selectOption('title');
  await expect(cards.first()).toContainText('Title 028');
  // A visible sentinel can legitimately append another batch after sorting.
  // Assert global ordering, including the last upstream page, rather than a timing-dependent batch count.
  const titles = await cards.locator('h3').allTextContents();
  expect(titles.length).toBeGreaterThanOrEqual(24);
  expect(titles).toEqual([...titles].sort());
  expect(requests.some((url) => url.includes('offset=48'))).toBe(true);
  expect(requests.every((url) => url.includes('subject=anime'))).toBe(true);
  const count = requests.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(cards).toHaveCount(24);
  expect(requests.length).toBe(count);
  await page.getByRole('button', { name: '瀑布流', exact: true }).click();
  await expect(page.locator('[data-gallery-layout]')).toHaveAttribute('data-gallery-layout', 'grid');
});

test('Hpoi requests one state, keeps loaded cards on failure and retries without duplicates', async ({ page }) => {
  await fixtures(page);
  let fail = true;
  const requests: string[] = [];
  await page.route('**/api/hpoi?**', (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    if (url.searchParams.has('page') && fail) return route.fulfill({ status: 502, json: { error: 'temporary' } });
    const more = !url.searchParams.has('page');
    return route.fulfill({
      json: {
        items: Array.from({ length: 24 }, (_, i) => hpoiItem(i + (more ? 1 : 24))),
        next: more ? '/api/hpoi?state=all&page=2&pages=2' : null,
        meta: {
          profile: { name: 'Fixture', profileUrl: 'https://www.hpoi.net/user/1', stats: {} },
          warnings: [],
          fetchedAt: '2026-10-02T00:00:00Z',
        },
      },
    });
  });
  await page.goto('/hpoi', { waitUntil: 'domcontentloaded' });
  const cards = page.locator('[data-gallery-layout] > a');
  await expect(cards).toHaveCount(24);
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: '继续加载', exact: true }).click();
  await expect(page.getByRole('button', { name: '加载失败，点击重试' })).toBeVisible();
  await expect(cards).toHaveCount(24);
  fail = false;
  await page.getByRole('button', { name: '加载失败，点击重试' }).click();
  await expect(cards).toHaveCount(47);
  const count = requests.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(cards).toHaveCount(24);
  expect(requests).toHaveLength(count);
});

test('late category responses cannot replace the current Bangumi tab', async ({ page }) => {
  await fixtures(page);
  let release: (() => void) | undefined;
  await page.route('**/api/bangumi?**', async (route) => {
    const subject = new URL(route.request().url()).searchParams.get('subject');
    if (subject === 'book')
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await route.fulfill({ json: { items: [bangumiItem(subject === 'game' ? 99 : 1)], next: null, total: 1 } });
  });
  await page.goto('/bangumi', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-gallery-layout] > a')).toHaveCount(1);
  await page.getByRole('button', { name: /书籍/ }).click();
  await expect.poll(() => !!release).toBe(true);
  await page.getByRole('button', { name: /游戏/ }).click();
  await expect(page.locator('[data-gallery-layout] > a')).toContainText('Title 001');
  release?.();
  await expect(page.locator('[data-gallery-layout] > a')).toContainText('Title 001');
});
