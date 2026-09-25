import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';

/** Local-only owner session exercises the existing auth boundary; writes are intercepted in browser tests. */
function session(id = 129171955) {
  const payload = Buffer.from(
    JSON.stringify({
      viewer: {
        id,
        login: 'owner-test',
        avatarUrl: 'https://example.com/avatar.png',
        profileUrl: 'https://github.com/owner-test',
      },
      expiresAt: Date.now() + 600_000,
    }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', process.env.STYLE_GALLERY_SESSION_SECRET ?? '')
    .update(payload)
    .digest('base64url')}`;
}

test('anonymous and non-owner requests cannot access profile mutation endpoints', async ({ request, baseURL }) => {
  expect((await request.post('/api/site-profile/admin', { data: {} })).status()).toBe(404);
  expect((await request.get('/api/site-profile/access')).status()).toBe(404);
  expect(
    (await request.get('/api/site-profile/admin', { headers: { cookie: `style_gallery_session=${session(123)}` } })).status(),
  ).toBe(404);
  if (process.env.STYLE_GALLERY_SESSION_SECRET)
    expect(
      (
        await request.post('/api/site-profile/admin', {
          headers: { cookie: `style_gallery_session=${session()}`, origin: 'https://other.example' },
          data: {},
        })
      ).status(),
    ).toBe(403);
  expect(baseURL).toMatch(/127\.0\.0\.1|localhost/);
});

test('owner editor keeps image history scrollable, locks the page and confirms pending edits', async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(!process.env.STYLE_GALLERY_SESSION_SECRET, 'Needs local auth configuration');
  await context.addCookies([{ name: 'style_gallery_session', value: session(), url: baseURL ?? 'http://127.0.0.1:4321' }]);
  await page.route('**/api/live2d**', (route) => route.abort());
  await page.route('**/api/site-assets/**', (route) =>
    route.fulfill({
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        'base64',
      ),
      contentType: 'image/png',
    }),
  );
  await page.goto('/admin?asset=home', { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: '更换首页' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '历史图片' })).toBeVisible();
  const height = await dialog.evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeLessThanOrEqual(870 * 0.85 + 2);
  expect(await page.locator('html').evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden');
  await page.screenshot({ path: '/tmp/site-profile-admin-desktop.png', fullPage: false });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('textbox', { name: '个人签名', exact: true }).fill('待保存的多行签名\n第二行');
  let confirmed = false;
  page.once('dialog', async (d) => {
    confirmed = true;
    expect(d.message()).toContain('确认发布');
    await d.dismiss();
  });
  await page.getByRole('button', { name: '保存并发布' }).click();
  expect(confirmed).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '更换首页', exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/site-profile-admin-mobile.png' });
});

test('generation prompt expands, scrolls independently, and copies complete text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/api/live2d**', (route) => route.abort());
  await page.route('**/api/site-assets/**', (route) =>
    route.fulfill({
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        'base64',
      ),
      contentType: 'image/png',
    }),
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const prompt = `第一行生成提示词\n${Array.from({ length: 100 }, (_, i) => `第 ${i + 1} 段：保留完整的生成细节。`).join('\n')}`;
  await page.evaluate(async (text) => {
    const modulePath = '/src/store/modal.ts';
    const { openModal } = await import(modulePath);
    openModal('imageLightbox', {
      images: [{ src: '/api/site-assets/home', alt: 'Prompt test', generationPrompt: text }],
      currentIndex: 0,
    });
  }, prompt);
  const details = page.locator('[data-image-lightbox] details');
  await expect(details).toBeVisible();
  await expect(details).not.toHaveAttribute('open', '');
  await details.locator('summary').click();
  const full = details.locator('section');
  await full.hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => full.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await details.getByRole('button').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
  await page.screenshot({ path: '/tmp/lightbox-generation-prompt.png' });
});
