import { expect, type Page, test } from '@playwright/test';

const slug = '2026-09-06-c63bb01cb14a';
const otherSlug = '2026-09-06-d9180e5abdb2';
const sourceSlug = '2026-07-14-4eaf44ebd787';
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="900"><rect width="640" height="900" fill="#ddadb8"/></svg>';

/** Browser tag writes are intercepted; these tests never change the configured HF account. */
async function fixture(page: Page, loggedIn = true) {
  let index = {
    version: 1,
    items: { [slug]: ['溶图'], [otherSlug]: ['专辑', '插画'], [sourceSlug]: ['溶图'] } as Record<string, string[]>,
  };
  const writes: unknown[] = [];
  let reads = 0;
  let prompts = 0;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/style-gallery/tags') {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        writes.push(body);
        index = { ...index, items: { ...index.items, [body.slug]: body.tags } };
        return route.fulfill({ json: index });
      }
      if (url.searchParams.has('edit') && !loggedIn) return route.fulfill({ status: 401, body: 'Login required' });
      reads++;
      return route.fulfill({ json: index });
    }
    if (url.pathname.includes('prompt-search-index')) {
      prompts++;
      return route.fulfill({ json: {} });
    }
    if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    if (url.pathname.startsWith('/api/live2d')) return route.abort();
    return route.continue();
  });
  return { writes, reads: () => reads, prompts: () => prompts };
}

test('preview tags filter immediately, keyboard suggestions save and all cards share one read', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/image-style-prompt-gallery');
  const first = page
    .locator('article')
    .filter({ has: page.locator(`a[href$="/${slug}"]`) })
    .first();
  await expect(first.getByRole('button', { name: '#溶图', exact: true })).toBeVisible();
  expect(state.reads()).toBe(1);
  await first.getByRole('button', { name: '编辑标签', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('combobox');
  await expect(input).toBeFocused();
  await input.fill('插');
  await input.press('Tab');
  await expect(dialog.getByRole('button', { name: '移除 插画' })).toBeVisible();
  await input.fill('实景');
  await input.press('Enter');
  await dialog.getByRole('button', { name: '保存标签', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.writes).toEqual([{ slug, tags: ['溶图', '插画', '实景'], previousTags: ['溶图'] }]);
  await page.getByRole('combobox', { name: '标签', exact: true }).selectOption('实景');
  await expect(page).toHaveURL(/tag=/);
  await expect(page.locator('[id^="style-gallery-preview-source-"]')).toHaveCount(1);
  expect(state.prompts()).toBe(0);
});

test('guests see GitHub login instead of editable fields', async ({ page }) => {
  const state = await fixture(page, false);
  await page.goto('/image-style-prompt-gallery');
  await page.getByRole('button', { name: '编辑标签', exact: true }).first().click();
  await expect(page.getByRole('dialog').getByRole('link', { name: /GitHub/ })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('combobox')).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test('index filters without card labels and its Lightbox shows source tags', async ({ page }) => {
  await fixture(page);
  await page.goto(`/image-style-prompt-gallery/index?tag=${encodeURIComponent('溶图')}`);
  await expect(page.getByRole('combobox', { name: '标签', exact: true })).toBeEnabled();
  await expect(page.locator('.gallery-tags-overlay')).toHaveCount(0);
  const card = page.locator('[id^="style-gallery-index-source-"]').first();
  await card.getByRole('button').click();
  await expect(page.getByRole('dialog').getByRole('link', { name: '#溶图', exact: true })).toBeVisible();
});

test('detail shows full labels and a source-image Lightbox inherits them', async ({ page }) => {
  await fixture(page);
  await page.goto(`/image-style-prompt-gallery/${slug}`);
  await expect(page.getByRole('link', { name: '#溶图', exact: true })).toBeVisible();
  await page.locator('[id^="style-gallery-detail-source-"]').first().click();
  await expect(page.getByRole('dialog').getByRole('link', { name: '#溶图', exact: true })).toBeVisible();
});

test('mobile sub-gallery inherits categories, filters whole groups and labels its Lightbox', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto(`/image-style-prompt-gallery/examples?tag=${encodeURIComponent('溶图')}`);
  const first = page.locator('[data-source-slug]').first();
  await expect(first).toHaveAttribute('data-source-slug', sourceSlug);
  await expect(first.getByRole('button', { name: '#溶图', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await first.locator('.gallery-source-stack').click();
  await expect(page.getByRole('dialog').getByRole('link', { name: '#溶图', exact: true })).toBeVisible();
});

test('hashtag search stays local and IME Enter does not prematurely add a suggestion', async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/image-style-prompt-gallery?q=${encodeURIComponent('#溶图')}`);
  await expect(page.locator('[id^="style-gallery-preview-source-"]')).toHaveCount(2);
  expect(state.prompts()).toBe(0);
  await page.getByRole('button', { name: '编辑标签', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('combobox');
  await expect(input).toBeFocused();
  await input.fill('插');
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(dialog.getByRole('button', { name: '移除 插画' })).toHaveCount(0);
  await input.press('Enter');
  await expect(dialog.getByRole('button', { name: '移除 插画' })).toBeVisible();
  await input.press('ArrowDown');
  await input.press('ArrowUp');
  await dialog.getByRole('option').first().click();
  await expect(input).toBeFocused();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(state.writes).toHaveLength(0);
});

test('a slow public response cannot replace tags saved through the fresh editor', async ({ page }) => {
  await fixture(page);
  let release: (() => void) | undefined;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/style-gallery/tags', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await delayed;
    return route.fulfill({ json: { version: 1, items: {} } });
  });
  await page.goto('/image-style-prompt-gallery');
  await page.getByRole('button', { name: '编辑标签', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await dialog.getByRole('combobox').fill('慢响应');
  await dialog.getByRole('button', { name: '保存标签', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  release?.();
  await expect(page.getByRole('combobox', { name: '标签', exact: true }).locator('option[value="慢响应"]')).toHaveCount(1);
  await page.waitForTimeout(300);
  await expect(page.getByRole('combobox', { name: '标签', exact: true }).locator('option[value="慢响应"]')).toHaveCount(1);
});

test('a concurrent edit reports a conflict and preserves the local draft', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/style-gallery/tags', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 409, body: 'Changed elsewhere' }) : route.fallback(),
  );
  await page.goto('/image-style-prompt-gallery');
  await page.getByRole('button', { name: '编辑标签', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await dialog.getByRole('combobox').fill('未丢失');
  await dialog.getByRole('button', { name: '保存标签', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('其他会话');
  await expect(dialog.getByRole('combobox')).toHaveValue('未丢失');
});
