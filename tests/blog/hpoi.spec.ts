import { expect, type Page, test } from '@playwright/test';

const states = ['all', 'care', 'want', 'preorder', 'buy', 'resell'];
const figure = (id: string) => ({
  id,
  title: `手办 ${id}`,
  imageUrl: 'https://rfx.hpoi.net/gk/cover/n/cover.jpg',
  detailUrl: `https://www.hpoi.net/hobby/${id}`,
  releaseText: '出荷：2027年9月28日',
  releaseDate: '2027-09-28',
  score: '4.79',
});
const meta = {
  profile: {
    userId: '1',
    name: 'Hpoi',
    profileUrl: 'https://www.hpoi.net/user/1',
    avatarUrl: null,
    signature: null,
    stats: {},
  },
  warnings: [],
  fetchedAt: '2026-11-15T00:00:00Z',
};
async function setup(page: Page) {
  await page.route('**/api/hpoi/ratings?**', (route) => {
    const ids = new URL(route.request().url()).searchParams.get('ids')?.split(',') ?? [];
    return route.fulfill({
      json: Object.fromEntries(
        ids.map((id) => [id, { score: '4.79', imageUrl: 'https://rfx.hpoi.net/gk/pic/n/official.jpg' }]),
      ),
    });
  });
  await page.route('**/api/hpoi/image?**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="750" height="1050"><rect width="750" height="1050" fill="#bea7c8"/></svg>',
    }),
  );
  await page.route('**/api/live2d-assets/**', (route) => route.abort());
}

test('prefetches category membership once, preserves cached switches and reloads, and uses official photos', async ({
  page,
}) => {
  await setup(page);
  const requests: string[] = [];
  await page.route(/\/api\/hpoi\?/, (route) => {
    const state = new URL(route.request().url()).searchParams.get('state') ?? 'all';
    requests.push(state);
    return route.fulfill({ json: { items: [figure(String(states.indexOf(state) + 1))], next: null, meta } });
  });
  await page.goto('/hpoi/');
  await expect.poll(() => requests.length).toBe(6);
  for (const [name, id] of [
    ['关注', '2'],
    ['想买', '3'],
    ['全部', '1'],
  ]) {
    await page.getByRole('tab', { name, exact: false }).click();
    await expect(page.getByRole('heading', { name: `手办 ${id}`, exact: true })).toBeVisible();
  }
  expect(requests).toHaveLength(6);
  await expect(page.locator('img[alt="手办 1"]')).toHaveAttribute('src', /official.jpg/);
  await page.reload();
  await expect(page.getByRole('heading', { name: '手办 1', exact: true })).toBeVisible();
  expect(requests).toHaveLength(6);
});

test('failed refresh retains a complete snapshot until a later successful crawl proves deletions', async ({ page }) => {
  await setup(page);
  await page.addInitScript(
    ({ meta, items, states }) => {
      if (!localStorage.getItem('hpoi-snapshots-v2'))
        localStorage.setItem(
          'hpoi-snapshots-v2',
          JSON.stringify(Object.fromEntries(states.map((state) => [state, { items, meta, complete: true, savedAt: 1 }]))),
        );
    },
    { meta, items: [figure('1'), figure('2')], states },
  );
  let fail = true;
  await page.route(/\/api\/hpoi\?/, (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('page') && fail) return route.fulfill({ status: 502, body: 'Temporary failure' });
    return route.fulfill({
      json: {
        items: url.searchParams.has('page') ? [figure('3')] : [figure('2')],
        next: url.searchParams.has('page') ? null : `/api/hpoi?state=${url.searchParams.get('state')}&page=2&pages=2`,
        meta,
      },
    });
  });
  await page.goto('/hpoi/');
  await expect(page.getByRole('heading', { name: '手办 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '加载失败，点击重试', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '手办 1', exact: true })).toBeVisible();
  fail = false;
  await page.reload();
  await expect(page.getByRole('heading', { name: '手办 3', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '手办 1', exact: true })).toHaveCount(0);
});

for (const [width, columns] of [
  [1512, 4],
  [2560, 6],
  [390, 1],
]) {
  test(`uses the available width at ${width}px without horizontal overflow`, async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width, height: 982 });
    await page.route(/\/api\/hpoi\?/, (route) =>
      route.fulfill({ json: { items: Array.from({ length: 12 }, (_, i) => figure(String(i + 1))), next: null, meta } }),
    );
    await page.goto('/hpoi/');
    const grid = page.locator('[data-gallery-layout]');
    await expect(grid.locator('a')).toHaveCount(12);
    const sizes = await grid.evaluate((el) => ({
      columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
      layout: document.querySelector('.page-reading-layout')?.getBoundingClientRect().width,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(sizes.columns).toBe(columns);
    expect(sizes.layout).toBeGreaterThan(width * 0.9);
    expect(sizes.scroll).toBeLessThanOrEqual(width);
  });
}

test('owner invalidation rejects an older in-flight crawl before it can repopulate snapshots', async ({ page }) => {
  await setup(page);
  await page.addInitScript(
    ({ meta, states }) => {
      localStorage.setItem(
        'hpoi-snapshots-v2',
        JSON.stringify(
          Object.fromEntries(
            states.map((state) => [state, { items: [], meta, complete: true, savedAt: state === 'all' ? 1 : Date.now() }]),
          ),
        ),
      );
    },
    { meta, states },
  );
  let invalidated = false;
  let held = false;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/hpoi\?/, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('page')) {
      held = true;
      await gate;
      return route.fulfill({ json: { items: [figure('3')], next: null, meta } });
    }
    return route.fulfill({
      json: { items: [figure(invalidated ? '4' : '2')], next: invalidated ? null : '/api/hpoi?state=all&page=2&pages=2', meta },
    });
  });
  await page.goto('/hpoi/');
  await expect.poll(() => held).toBe(true);
  invalidated = true;
  // Exercise the same exported invalidation boundary as the authenticated admin action,
  // without inventing production credentials or sending a real cache-purge request.
  await page.evaluate(async () => {
    const modulePath = '/src/hooks/useHpoiCollection.ts';
    const { invalidateHpoiSnapshots } = await import(modulePath);
    invalidateHpoiSnapshots();
  });
  expect(await page.evaluate(() => localStorage.getItem('hpoi-snapshots-v2'))).toBeNull();
  release();
  await expect(page.getByRole('heading', { name: '手办 4', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '手办 3', exact: true })).toHaveCount(0);
});

test('retrying an incomplete crawl retains cards from pages not yet revisited', async ({ page }) => {
  await setup(page);
  let retry = false;
  await page.route(/\/api\/hpoi\?/, (route) => {
    const url = new URL(route.request().url());
    const state = url.searchParams.get('state');
    if (state !== 'all') return route.fulfill({ json: { items: [], next: null, meta } });
    if (url.searchParams.has('page')) return route.fulfill({ status: 502, body: 'Temporary failure' });
    return route.fulfill({
      json: { items: retry ? [figure('1')] : [figure('1'), figure('2')], next: '/api/hpoi?state=all&page=2&pages=2', meta },
    });
  });
  await page.goto('/hpoi/');
  const retryButton = page.getByRole('button', { name: '加载失败，点击重试', exact: true });
  await expect(retryButton).toBeVisible();
  await expect(page.getByRole('heading', { name: '手办 2', exact: true })).toBeVisible();
  retry = true;
  await retryButton.click();
  await expect(retryButton).toBeVisible();
  await expect(page.getByRole('heading', { name: '手办 2', exact: true })).toBeVisible();
});
