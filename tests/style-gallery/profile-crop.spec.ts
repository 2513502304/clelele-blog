import { createHmac } from 'node:crypto';
import { type BrowserContext, expect, test } from '@playwright/test';
import sharp from 'sharp';

async function owner(context: BrowserContext) {
  const payload = Buffer.from(
    JSON.stringify({
      viewer: {
        id: 129171955,
        login: 'fixture-owner',
        avatarUrl: 'https://example.com/a.png',
        profileUrl: 'https://github.com/fixture',
      },
      expiresAt: Date.now() + 600_000,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', 'profile-fixture-secret-for-local-tests-only').update(payload).digest('base64url');
  await context.addCookies([{ name: 'style_gallery_session', value: `${payload}.${signature}`, url: 'http://127.0.0.1:4340' }]);
}
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="400" height="600" fill="#dc84a8"/><rect x="400" width="400" height="600" fill="#71cdb4"/><circle cx="400" cy="300" r="150" fill="#fff0ca"/></svg>';

test('history deletion protects active images, enforces auth, CSRF and revision checks', async ({ request, context, page }) => {
  expect((await request.delete('/api/site-profile/admin', { data: {} })).status()).toBe(404);
  expect((await request.get('/api/site-profile/source?key=images/x.png')).status()).toBe(404);
  await owner(context);
  const initial = await (await context.request.get('/api/site-profile/admin')).json();
  const upload = await context.request.post('/api/site-profile/admin', {
    multipart: {
      revision: initial.revision,
      file: { name: 'remove-me.png', mimeType: 'image/png', buffer: await sharp(Buffer.from(svg)).png().toBuffer() },
    },
  });
  expect(upload.ok()).toBe(true);
  const { profile, asset: removable } = await upload.json();
  const activeName = profile.history.find((asset: { key: string }) => asset.key === profile.assets.avatar).name;
  const active = { revision: profile.revision, key: profile.assets.avatar };
  expect(
    (
      await context.request.delete('/api/site-profile/admin', { data: active, headers: { Origin: 'https://other.example' } })
    ).status(),
  ).toBe(403);
  expect((await context.request.delete('/api/site-profile/admin', { data: active })).status()).toBe(409);
  await page.route('**/api/live2d**', (route) => route.abort());
  await page.goto('/admin?asset=avatar', { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: /^更换/ });
  await expect(dialog.getByRole('button', { name: `删除历史图片 ${activeName}`, exact: true })).toBeDisabled();
  const remove = dialog.getByRole('button', { name: '删除历史图片 remove-me.png', exact: true });
  page.once('dialog', (d) => d.dismiss());
  await remove.click();
  await expect(remove).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await remove.click();
  await expect(remove).toHaveCount(0);
  const updated = await (await context.request.get('/api/site-profile/admin')).json();
  expect(updated.history).toHaveLength(initial.history.length);
  expect((await context.request.delete('/api/site-profile/admin', { data: { ...active, key: removable.key } })).status()).toBe(
    409,
  );
  expect((await context.request.get(`/api/site-profile/source?key=${encodeURIComponent(removable.key)}`)).status()).toBe(404);
});

test('file and clipboard enter crop editor; preview exports a bounded image and only publishes after confirmation', async ({
  page,
  context,
}) => {
  await owner(context);
  const original = await (await context.request.get('/api/site-profile/admin')).json();
  await page.route('**/api/live2d**', (route) => route.abort());
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  await page.route('**/api/site-assets/**', (route) => route.fulfill({ body: png, contentType: 'image/png' }));
  await page.goto('/admin?asset=avatar', { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: /^更换/ });
  await dialog.locator('input[type=file]').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: png });
  const stage = dialog.locator('[data-crop-stage]');
  await expect(stage).toBeVisible();
  await expect(stage.locator('img')).toHaveJSProperty('naturalWidth', 800);
  const box = await stage.boundingBox();
  expect(box?.width).toBeCloseTo(box?.height ?? 0, 0);
  const zoom = dialog.getByLabel('缩放', { exact: true });
  const slider = await zoom.boundingBox();
  if (!slider) throw new Error('Zoom slider missing');
  await page.mouse.move(slider.x + 8, slider.y + slider.height / 2);
  await page.mouse.down();
  await page.mouse.move(slider.x + slider.width * 0.65, slider.y + slider.height / 2, { steps: 12 });
  await page.mouse.up();
  expect(Number(await zoom.inputValue())).toBeGreaterThan(2.5);
  const zoomed = await stage.locator('img').boundingBox();
  expect(zoomed?.width).toBeGreaterThan((box?.width ?? 0) * 2.5);
  await zoom.fill('2');
  if (!box) throw new Error('Crop stage missing');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.screenshot({ path: '/tmp/profile-avatar-crop.png' });
  const uploaded = page.waitForResponse(
    (response) => response.url().endsWith('/api/site-profile/admin') && response.request().method() === 'POST',
  );
  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: '使用这个构图' }).click();
  const result = await (await uploaded).json();
  expect(result.asset.width).toBe(300);
  expect(result.asset.height).toBe(300);
  expect(result.asset.key).toMatch(/\.(webp|png)$/);
  expect(result.asset.name.split('.').at(-1)).toBe(result.asset.key.split('.').at(-1));
  expect(result.profile.assets.avatar).toBe(original.assets.avatar);
  await expect(dialog).toHaveCount(0);
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '保存并发布' }).click();
  expect((await (await context.request.get('/api/site-profile/admin')).json()).assets.avatar).toBe(original.assets.avatar);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '保存并发布' }).click();
  await expect(page.locator('output')).toContainText('已保存');
  expect((await (await context.request.get('/api/site-profile/admin')).json()).assets.avatar).toBe(result.asset.key);
  await page.getByRole('button', { name: '更换首页', exact: true }).click();
  await dialog.evaluate((element, base64) => {
    const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([data], 'pasted.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }));
  }, png.toString('base64'));
  await expect(stage).toBeVisible();
  const banner = await stage.boundingBox();
  expect((banner?.width ?? 0) / (banner?.height ?? 1)).toBeCloseTo(1512 / (870 * 0.6), 1);
  await page.screenshot({ path: '/tmp/profile-banner-crop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await dialog.boundingBox())?.width).toBeLessThanOrEqual(390);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.locator('html').evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden');
  await page.screenshot({ path: '/tmp/profile-crop-mobile.png' });
});

test('quick edit is hover/focus-only and the avatar retains its shake animation', async ({ page, context }) => {
  await owner(context);
  await page.route('**/api/live2d**', (route) => route.abort());
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  const edit = page.getByRole('link', { name: '更换头像', exact: true }).first();
  await expect(edit).toHaveCSS('opacity', '0');
  const avatar = edit.locator('xpath=ancestor::*[@data-profile-asset]');
  await avatar.hover();
  await expect(edit).toHaveCSS('opacity', '1');
  await expect(avatar.locator('img')).toHaveCSS('animation-name', 'shake');
  await expect(avatar.locator('img')).toHaveCSS('animation-duration', '2s');
  await expect(avatar.locator('img')).toHaveCSS('animation-timing-function', 'ease');
  await page.mouse.move(0, 0);
  await edit.focus();
  await expect(edit).toHaveCSS('opacity', '1');
});
