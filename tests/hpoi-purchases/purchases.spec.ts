import { createHmac } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';

const secret = 'hpoi-local-e2e-session-secret-0000000000000000';
async function login(page: Page, id = 1001) {
  const payload = Buffer.from(
    JSON.stringify({
      viewer: {
        id,
        login: 'synthetic-owner',
        avatarUrl: 'https://example.test/avatar.png',
        profileUrl: 'https://github.com/synthetic-owner',
      },
      expiresAt: Date.now() + 60_000,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  await page
    .context()
    .addCookies([
      { name: 'style_gallery_session', value: `${payload}.${signature}`, url: 'http://127.0.0.1:4347', httpOnly: true },
    ]);
}

const oldSnapshot = {
  fetchedAt: '2026-01-01T00:00:00.000Z',
  records: [
    {
      figureId: '7',
      itemId: '42',
      collectionId: '101',
      title: 'Synthetic owner figure',
      state: 'buy',
      stateLabel: '已入',
      orderTime: '2026-01-02',
      orderWay: 'Synthetic shop',
      orderMoney: null,
      orderMoneyCurrency: 'rmb',
      currencyLabel: '人民币',
      orderForm: '2',
      orderFormLabel: '现货',
      tags: null,
      comment: null,
    },
  ],
};
const view = { configured: true, canRefresh: true, snapshot: oldSnapshot, job: null };
async function adminSetup(page: Page) {
  await login(page);
  await page.route('**/api/hpoi', (route) =>
    route.fulfill({
      json: {
        profile: {},
        collections: { all: [], care: [], want: [], preorder: [], buy: [], resell: [] },
        fetchedAt: '2026-01-01T00:00:00.000Z',
        warnings: [],
      },
    }),
  );
  await page.route('**/api/live2d-assets/**', (route) => route.abort());
}

test('non-owners receive private no-store 404s and owner mutations enforce same-origin', async ({ page, request }) => {
  const get = await request.get('/api/hpoi/purchases');
  expect(get.status()).toBe(404);
  expect(get.headers()['cache-control']).toBe('private, no-store');
  expect((await request.get('/api/hpoi/purchases?figureId=7')).status()).toBe(404);
  expect((await request.post('/api/hpoi/purchases', { data: { action: 'start' } })).status()).toBe(404);
  await login(page, 1002);
  expect((await page.request.get('/api/hpoi/purchases')).status()).toBe(404);
  await login(page);
  const disabled = await page.request.get('/api/hpoi/purchases');
  expect(disabled.status()).toBe(200);
  expect((await disabled.json()).configured).toBe(false);
  const figure = await page.request.get('/api/hpoi/purchases?figureId=7');
  expect(await figure.json()).toEqual({ records: [] });
  expect((await page.request.get('/api/hpoi/purchases?figureId=nope')).status()).toBe(400);
  expect(
    (
      await page.request.post('/api/hpoi/purchases', {
        headers: { origin: 'https://other.example.test' },
        data: { action: 'start' },
      })
    ).status(),
  ).toBe(403);
});

test('the public collection page adds no purchase requests or private component downloads', async ({ page }) => {
  const privateRequests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/hpoi/purchases') || /\/HpoiPurchase(?:Detail|sAdmin)\./.test(path))
      privateRequests.push(request.url());
  });
  await page.route(/\/api\/hpoi\?/, (route) =>
    route.fulfill({
      headers: { 'x-hpoi-image-policy': 'original-v2' },
      json: {
        items: [],
        next: null,
        meta: { profile: { name: 'Synthetic', userId: '1', stats: {} }, fetchedAt: '2026-01-01T00:00:00.000Z', warnings: [] },
      },
    }),
  );
  await page.route('**/api/live2d-assets/**', (route) => route.abort());
  await page.goto('/hpoi');
  await expect(page.getByRole('tab', { name: /全部/ })).toBeVisible();
  expect(privateRequests).toEqual([]);
  await expect(page.getByRole('button', { name: '我的入手记录' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查看本人购买信息' })).toHaveCount(0);
});

test('the owner explicitly opens the lazy panel; refresh failure retains the old snapshot and never persists purchases locally', async ({
  page,
}) => {
  await adminSetup(page);
  let reads = 0;
  let posts = 0;
  await page.route('**/api/hpoi/purchases', async (route) => {
    if (route.request().method() === 'GET') {
      reads++;
      return route.fulfill({ json: view });
    }
    posts++;
    const body = route.request().postDataJSON();
    if (body.action === 'start')
      return route.fulfill({
        json: {
          ...view,
          job: { id: '00000000-0000-4000-8000-000000000001', phase: 'details', done: 0, total: 2, error: false, busy: false },
        },
      });
    return route.fulfill({ status: 503, body: 'Paused' });
  });
  await page.goto('/hpoi/admin');
  const open = page.getByRole('button', { name: '查看本人购买信息', exact: true });
  await expect(open).toBeVisible();
  expect(reads).toBe(0);
  expect(posts).toBe(0);
  await open.click();
  await expect(page.getByRole('link', { name: '前往 Hpoi 官网登录', exact: true })).toHaveAttribute(
    'href',
    'https://www.hpoi.net/user/login',
  );
  await expect(page.getByText('官网登录与博客同步分开管理；登录官网不会自动连接本站。', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Synthetic shop', exact: true })).toBeVisible();
  expect(reads).toBe(1);
  const row = page.getByRole('row', { name: /Synthetic owner figure/ });
  await expect(row.getByRole('cell', { name: '未填写', exact: true })).toHaveCount(1);
  expect(posts).toBe(0);
  await page.getByRole('button', { name: '刷新购买信息', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('保留上次快照');
  await expect(row).toBeVisible();
  await expect(page.getByRole('button', { name: '继续同步', exact: true })).toBeEnabled();
  expect(posts).toBe(2);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('Synthetic shop');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('without a sync session the owner can still read a saved snapshot and use the separate official login link', async ({
  page,
}) => {
  await adminSetup(page);
  let posts = 0;
  await page.route('**/api/hpoi/purchases', (route) => {
    if (route.request().method() === 'POST') posts++;
    return route.fulfill({ json: { ...view, canRefresh: false } });
  });
  await page.goto('/hpoi/admin');
  await page.getByRole('button', { name: '查看本人购买信息', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Synthetic shop', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新购买信息', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: '前往 Hpoi 官网登录', exact: true })).toHaveAttribute(
    'href',
    'https://www.hpoi.net/user/login',
  );
  await expect(
    page.getByText('博客尚未建立 Hpoi 同步连接，已缓存资料仍可查看。正式委托授权暂未接入。', { exact: true }),
  ).toBeVisible();
  expect(posts).toBe(0);
});

async function collectionSetup(page: Page) {
  await login(page);
  const figure = { id: '7', title: '合成测试藏品', detailUrl: 'https://www.hpoi.net/hobby/7', score: '4.5' };
  await page.route(/\/api\/hpoi\?/, (route) =>
    route.fulfill({
      headers: { 'x-hpoi-image-policy': 'original-v2' },
      json: {
        next: null,
        items: [figure],
        meta: {
          profile: { name: 'Synthetic', userId: '1', profileUrl: 'https://www.hpoi.net/user/1', stats: {} },
          warnings: [],
          fetchedAt: oldSnapshot.fetchedAt,
        },
      },
    }),
  );
  return figure;
}

test('a failed private module leaves the public collection and owner toggle usable', async ({ page }) => {
  await collectionSetup(page);
  await page.route('**/HpoiPurchaseDetail.tsx*', (r) => r.abort());
  await page.goto('/hpoi');
  const open = page.getByRole('button', { name: '我的入手记录' });
  await open.click();
  await expect(page.getByRole('button', { name: '重新载入页面' })).toBeVisible();
  await expect(page.getByRole('link', { name: /合成测试藏品/ })).toBeVisible();
  await open.click();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
});

test('owner opens a figure in place, retries a failed read and can close without losing the original link', async ({
  page,
}) => {
  const figure = await collectionSetup(page);
  let reads = 0;
  await page.route('**/api/hpoi/purchases?figureId=7', (route) =>
    ++reads === 1 ? route.fulfill({ status: 503 }) : route.fulfill({ json: { records: oldSnapshot.records } }),
  );
  await page.goto('/hpoi');
  const action = page.getByRole('button', { name: '我的入手记录' });
  await expect(action).toBeVisible();
  expect(reads).toBe(0);
  await action.click();
  const retry = page.getByRole('region', { name: '我的入手记录' }).getByRole('button', { name: '重试', exact: true });
  await retry.evaluate((button) => button.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await retry.click();
  await expect(page.getByText('Synthetic shop')).toBeVisible();
  expect(reads).toBe(2);
  await expect(page.getByRole('link', { name: /合成测试藏品/ })).toHaveAttribute('href', figure.detailUrl);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('Synthetic shop');
  await action.click();
  await expect(page.getByText('Synthetic shop')).toHaveCount(0);
});

test('owner exports only matching currency and missing-amount records', async ({ page }) => {
  await adminSetup(page);
  const record = oldSnapshot.records[0];
  await page.route('**/api/hpoi/purchases', (route) =>
    route.fulfill({
      json: {
        ...view,
        snapshot: {
          ...oldSnapshot,
          records: [
            record,
            {
              ...record,
              collectionId: '102',
              title: 'JPY zero',
              orderMoney: '0',
              orderMoneyCurrency: 'jpy',
              currencyLabel: '日元',
            },
            {
              ...record,
              collectionId: '103',
              title: 'Japanese figure',
              orderMoneyCurrency: 'jpy',
              currencyLabel: '日元',
              comment: '=1+1',
            },
          ],
        },
      },
    }),
  );
  await page.goto('/hpoi/admin');
  await page.getByRole('button', { name: '查看本人购买信息' }).click();
  await page.getByRole('combobox', { name: '币种', exact: true }).selectOption('code:jpy');
  await expect(page.getByRole('cell', { name: 'JPY zero' })).toBeVisible();
  await page.getByLabel('仅看未填金额').check();
  await expect(page.getByRole('cell', { name: 'JPY zero' })).toHaveCount(0);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出当前结果 CSV' }).click();
  const stream = await (await downloaded).createReadStream();
  const chunks: Buffer[] = [];
  if (!stream) throw new Error('Missing CSV download');
  for await (const chunk of stream) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString('utf8');
  expect(csv).toContain('Japanese figure');
  expect(csv).toContain("'=1+1");
  expect(csv).not.toContain('Synthetic owner figure');
  expect(csv).not.toContain('JPY zero');
});
