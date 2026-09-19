import { expect, test } from '@playwright/test';

test('cached tags open without an edit read; a write conflict forces a fresh snapshot on reopen', async ({ page }) => {
  let freshReads = 0;
  let writes = 0;
  let slug = '';
  await page.addInitScript(() => localStorage.setItem('style-gallery-upload-token', 'test-only'));
  await page.route('**/api/style-gallery/tags**', async (route) => {
    if (route.request().method() === 'PUT') {
      writes++;
      return route.fulfill({ status: 409, body: 'Conflict' });
    }
    const editing = route.request().url().includes('edit=1');
    if (editing) freshReads++;
    return route.fulfill({ json: { version: 1, items: slug ? { [slug]: [editing ? '新标签' : '插画'] } : {} } });
  });
  await page.route('**/api/live2d/**', (route) => route.abort());
  await page.goto('/image-style-prompt-gallery', { waitUntil: 'domcontentloaded' });
  const first = page.locator('[data-gallery-selection-id]').first();
  slug = (await first.getAttribute('data-gallery-selection-id')) ?? '';
  const edit = first.getByRole('button', { name: '编辑标签', exact: true });
  await expect.poll(() => edit.evaluate((el) => !el.closest('astro-island')?.hasAttribute('ssr'))).toBe(true);
  await expect(page.locator('[data-gallery-tag-filter] select')).toBeEnabled();
  await edit.click();
  const dialog = page.getByRole('dialog', { name: '编辑标签', exact: true });
  const input = dialog.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 1000 });
  expect(freshReads).toBe(0);
  await input.fill('测试');
  await dialog.getByRole('button', { name: '保存标签', exact: true }).click();
  await expect(dialog.getByText('标签已被其他会话修改，请关闭后重新打开编辑器。')).toBeVisible();
  expect(writes).toBe(1);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await edit.click();
  await expect(input).toBeVisible();
  expect(freshReads).toBe(1);
  await expect(dialog.getByRole('button', { name: '移除 新标签' })).toBeVisible();
});
