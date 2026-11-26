import { expect, type Page, test } from '@playwright/test';

const imagePolicyHeaders = { 'x-hpoi-image-policy': 'original-v2' };
const states = ['all', 'care', 'want', 'preorder', 'buy', 'resell'];
const figure = (id: string) => ({
  id,
  title: `手办 ${id}`,
  imageUrl: `/api/hpoi/cached-image?key=${'a'.repeat(64)}.jpg`,
  imageFallbackUrl: `/api/hpoi/cached-image?key=${'b'.repeat(64)}.jpg`,
  imageWidth: 360,
  imageHeight: 520,
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
      headers: imagePolicyHeaders,
      json: Object.fromEntries(
        ids.map((id) => [id, { score: '4.79', imageUrl: 'https://rfx.hpoi.net/gk/pic/n/official.jpg' }]),
      ),
    });
  });
  await page.route('**/api/hpoi/cached-image?**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="750" height="1050"><rect width="750" height="1050" fill="#bea7c8"/></svg>',
    }),
  );
  await page.route('**/api/live2d-assets/**', (route) => route.abort());
}

test('an old container response in the CDN is bypassed before publishing an original-image snapshot', async ({ page }) => {
  await setup(page);
  let bypasses = 0;
  await page.route(/\/api\/hpoi\?/, (route) => {
    if (route.request().headers().range) {
      bypasses++;
      return route.fulfill({ headers: imagePolicyHeaders, json: { items: [figure('126224')], next: null, meta } });
    }
    return route.fulfill({
      json: { items: [{ ...figure('old'), imageUrl: 'https://rfx.hpoi.net/gk/pic/s/old.jpg' }], next: null, meta },
    });
  });
  await page.goto('/hpoi/');
  await expect(page.getByRole('heading', { name: '手办 126224', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '手办 old', exact: true })).toHaveCount(0);
  await expect.poll(() => bypasses).toBe(6);
});

test('prefetches category membership once, preserves cached switches and reloads, and uses cached matched photos', async ({
  page,
}) => {
  await setup(page);
  const requests: string[] = [];
  await page.route(/\/api\/hpoi\?/, (route) => {
    const state = new URL(route.request().url()).searchParams.get('state') ?? 'all';
    requests.push(state);
    return route.fulfill({
      headers: imagePolicyHeaders,
      json: { items: [figure(String(states.indexOf(state) + 1))], next: null, meta },
    });
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
  await expect(page.locator('img[alt="手办 1"]')).toHaveAttribute('src', /cached-image/);
  await page.reload();
  await expect(page.getByRole('heading', { name: '手办 1', exact: true })).toBeVisible();
  expect(requests).toHaveLength(6);
});

test('failed refresh retains a complete snapshot until a later successful crawl proves deletions', async ({ page }) => {
  await setup(page);
  await page.addInitScript(
    ({ meta, items, states }) => {
      if (!localStorage.getItem('hpoi-snapshots-v4'))
        localStorage.setItem(
          'hpoi-snapshots-v4',
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
      headers: imagePolicyHeaders,
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
      route.fulfill({
        headers: imagePolicyHeaders,
        json: { items: Array.from({ length: 12 }, (_, i) => figure(String(i + 1))), next: null, meta },
      }),
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
        'hpoi-snapshots-v4',
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
      return route.fulfill({ headers: imagePolicyHeaders, json: { items: [figure('3')], next: null, meta } });
    }
    return route.fulfill({
      headers: imagePolicyHeaders,
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
  expect(await page.evaluate(() => localStorage.getItem('hpoi-snapshots-v4'))).toBeNull();
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
    if (state !== 'all') return route.fulfill({ headers: imagePolicyHeaders, json: { items: [], next: null, meta } });
    if (url.searchParams.has('page')) return route.fulfill({ status: 502, body: 'Temporary failure' });
    return route.fulfill({
      headers: imagePolicyHeaders,
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

test('matched originals reserve their native geometry and a failed image settles on one fallback', async ({ page }) => {
  await setup(page);
  const title = '艺术家杰作+ 约会大作战第四季 时崎狂三—刻刻帝—';
  await page.route(/\/api\/hpoi\?/, (route) =>
    route.fulfill({
      headers: imagePolicyHeaders,
      json: { items: [{ ...figure('77004'), title, imageWidth: 1199, imageHeight: 1799 }], next: null, meta },
    }),
  );
  await page.route('**/api/hpoi/cached-image?**', async (route) => {
    if (route.request().url().includes('a'.repeat(64))) return route.fulfill({ status: 502, body: 'Unavailable' });
    await new Promise((resolve) => setTimeout(resolve, 250));
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"/>',
    });
  });
  await page.goto('/hpoi/');
  const heading = page.getByRole('heading', { name: title, exact: true });
  await expect(heading).toBeVisible();
  expect(await heading.evaluate((el) => getComputedStyle(el).textWrap)).toBe('wrap');
  const img = page.locator(`img[alt="${title}"]`);
  await expect(img).toHaveAttribute('src', new RegExp('b'.repeat(64)));
  const box = await img.evaluate((el) => {
    const parent = el.parentElement;
    if (!parent) throw new Error('Missing image container');
    return { ratio: getComputedStyle(parent).aspectRatio, height: parent.getBoundingClientRect().height };
  });
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete)).toBe(true);
  expect(await img.evaluate((el) => el.parentElement?.getBoundingClientRect().height)).toBe(box.height);
  expect(box.ratio).toBe('1199 / 1799');
});

test('old thumbnail snapshots cannot survive the original-image cache version upgrade', async ({ page }) => {
  await setup(page);
  await page.addInitScript(
    ({ meta, item }) => {
      localStorage.setItem(
        'hpoi-snapshots-v3',
        JSON.stringify({
          all: {
            items: [{ ...item, imageUrl: 'https://rfx.hpoi.net/gk/pic/s/old.jpg' }],
            meta,
            complete: true,
            savedAt: Date.now(),
          },
        }),
      );
    },
    { meta, item: figure('126224') },
  );
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.route(/\/api\/hpoi\?/, (route) => {
    expect(new URL(route.request().url()).searchParams.get('images')).toBe('original-v2');
    return route.fulfill({
      headers: imagePolicyHeaders,
      json: { items: [{ ...figure('126224'), imageWidth: 750, imageHeight: 1050 }], next: null, meta },
    });
  });
  await page.goto('/hpoi/');
  const img = page.locator('img[alt="手办 126224"]');
  await expect(img).toHaveAttribute('src', /cached-image/);
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(750);
  expect(requests.some((url) => decodeURIComponent(url).includes('/pic/s/'))).toBe(false);
});

test('preorder calendar distinguishes exact dates from month-only and undated releases using existing category reads', async ({
  page,
}) => {
  await setup(page);
  const fixed = figure('1'),
    monthly = { ...figure('2'), releaseDate: null, releaseText: '出荷：2027年9月' },
    unknown = { ...figure('3'), releaseDate: null, releaseText: '出荷：未定' };
  const seen: string[] = [];
  await page.route(/\/api\/hpoi\?/, (route) => {
    const state = new URL(route.request().url()).searchParams.get('state') ?? '';
    seen.push(state);
    return route.fulfill({
      headers: imagePolicyHeaders,
      json: { meta, next: null, items: ['all', 'preorder'].includes(state) ? [fixed, monthly, unknown] : [] },
    });
  });
  await page.goto('/hpoi/');
  await expect(page.locator('[data-hpoi-category=preorder]')).toHaveCount(3);
  await page.getByRole('button', { name: '出荷日历', exact: true }).click();
  const calendar = page.getByRole('region', { name: '出荷日历' });
  await expect(page.getByRole('tab', { name: /预定/ })).toHaveAttribute('aria-selected', 'true');
  await expect(calendar.locator('li')).toHaveCount(2);
  await calendar.getByRole('button', { name: '2027-09-28 · 1' }).click();
  await expect(calendar.locator('li')).toHaveText(/手办 1/);
  await calendar.getByRole('button', { name: '日期待定 · 1' }).click();
  await expect(calendar.locator('li')).toHaveText(/手办 3/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '返回卡片' }).click();
  await expect(page.getByRole('tab', { name: /全部/ })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => seen.length).toBe(6);
});
