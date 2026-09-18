import { expect, type Page, test } from '@playwright/test';

const slug = '2026-09-06-c63bb01cb14a';
const otherSlug = '2026-09-06-d9180e5abdb2';
const sourceSlug = '2026-07-14-4eaf44ebd787';
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="900"><rect width="640" height="900" fill="#ddadb8"/></svg>';

/** Browser tag writes are intercepted; these tests never change the configured HF account. */
async function fixture(page: Page, authorized = true) {
  if (authorized) await page.addInitScript(() => localStorage.setItem('style-gallery-upload-token', 'test-only'));
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
        if (body.slugs) {
          for (const id of body.slugs) {
            const existing = index.items[id] ?? [];
            const next =
              body.mode === 'replace'
                ? body.tags
                : body.mode === 'remove'
                  ? existing.filter((tag: string) => !body.tags.includes(tag))
                  : [...new Set([...existing, ...body.tags])];
            if (next.length) index.items[id] = next;
            else delete index.items[id];
          }
        } else index = { ...index, items: { ...index.items, [body.slug]: body.tags } };
        expect(route.request().headers().authorization).toBe('Bearer test-only');
        return route.fulfill({ json: index });
      }
      if (url.searchParams.has('edit') && route.request().headers().authorization !== 'Bearer test-only')
        return route.fulfill({ status: 401, body: 'Login required' });
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
  // Keep the fixture sources mounted even as newly imported production images move them off the first page.
  await page.goto(`/image-style-prompt-gallery?tag=${encodeURIComponent('溶图')}`);
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

test('guests need the management token instead of a GitHub login', async ({ page }) => {
  const state = await fixture(page, false);
  await page.goto('/image-style-prompt-gallery');
  await page.getByRole('button', { name: '编辑标签', exact: true }).first().click();
  await expect(page.getByRole('dialog').getByLabel('Management token')).toBeVisible();
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
  const source = page.locator('[id^="style-gallery-detail-source-"]').first();
  await expect(source.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await source
    .getByRole('button', { name: /放大|查看|原图|lightbox/i })
    .first()
    .click();
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

for (const path of ['', '/index', '/examples']) {
  test(`failed prompt search allows bulk tagging the remaining local matches on ${path || 'preview'}`, async ({ page }) => {
    await fixture(page);
    await page.route('**/api/style-gallery/prompt-search-index', (route) => route.fulfill({ status: 503 }));
    // A source hash remains a valid local match when full-text prompt search is unavailable.
    await page.goto(`/image-style-prompt-gallery${path}?q=4eaf44ebd787`);
    await expect(page.locator('[data-gallery-selection]').locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
    await page.getByRole('button', { name: '批量标签', exact: true }).click();
    await expect(
      page.locator('[data-gallery-selection]').getByRole('button', { name: '全选筛选结果', exact: true }),
    ).toBeEnabled();
    await page.locator('[data-gallery-selection]').getByRole('button', { name: '全选筛选结果', exact: true }).click();
    await expect(page.locator('[data-gallery-selection] output')).toHaveText('1 / 1 个来源');
    await page.locator('[data-gallery-selection]').getByRole('button', { name: '批量编辑标签', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('combobox')).toBeFocused();
  });

  test(`plain text excludes tag-only matches on ${path || 'preview'}`, async ({ page }) => {
    const state = await fixture(page);
    await page.goto(`/image-style-prompt-gallery${path}?q=${encodeURIComponent('专辑')}`);
    await expect.poll(state.prompts).toBe(1);
    await expect(
      page.locator('[id^="style-gallery-preview-source-"], [id^="style-gallery-index-source-"], [data-source-slug]'),
    ).toHaveCount(0);
  });
}

test('batch select-all includes unmounted sources and only submits sources in the current filter', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/image-style-prompt-gallery');
  await expect(page.locator('[data-gallery-selection]').locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await page.getByRole('button', { name: '批量标签', exact: true }).click();
  await page.locator('[data-gallery-selection]').getByRole('button', { name: '全选筛选结果', exact: true }).click();
  const selectedCount = Number((await page.locator('[data-gallery-selection] output').innerText()).split(' / ')[0]);
  expect(selectedCount).toBeGreaterThan(await page.locator('input[type="checkbox"]').count());
  await page.getByRole('combobox', { name: '标签', exact: true }).selectOption('溶图');
  await expect(page.locator('[data-gallery-selection] output')).toHaveText('2 / 2 个来源');
  await page.locator('[data-gallery-selection]').getByRole('button', { name: '批量编辑标签', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await dialog.getByRole('combobox').fill('插画');
  await dialog.getByRole('button', { name: '添加标签', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.writes).toEqual([{ slugs: [slug, sourceSlug], tags: ['插画'] }]);
});

test('mobile index selection reuses the zoom slot without covering count badges', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto('/image-style-prompt-gallery/index');
  const card = page.locator('[id^="style-gallery-index-source-"]').first();
  await expect(card.getByRole('button')).toHaveCount(1);
  await expect(page.locator('[data-gallery-selection]').locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await page.getByRole('button', { name: '批量标签', exact: true }).click();
  await expect(card.getByRole('button')).toHaveCount(0);
  await card.getByRole('checkbox').check();
  const selection = await card.locator('label').boundingBox();
  const counts = await card.locator('span.absolute.bottom-6').boundingBox();
  if (!selection || !counts) throw new Error('Index selection controls are missing');
  expect(selection.y + selection.height).toBeLessThanOrEqual(counts.y);
  await page.locator('[data-gallery-selection]').getByRole('button', { name: '退出多选', exact: true }).click();
  await expect(card.getByRole('button')).toHaveCount(1);
  await expect(card.getByRole('checkbox')).toHaveCount(0);
});

test('detail example Lightbox shows source tags and its source badge', async ({ page }) => {
  await fixture(page);
  await page.goto(`/image-style-prompt-gallery/${sourceSlug}`);
  const card = page.locator('[id^="style-gallery-detail-example-"]').first();
  await expect(card.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await card.getByRole('button').first().click();
  await expect(page.getByRole('dialog').getByRole('link', { name: '#溶图', exact: true })).toBeVisible();
  await expect(page.locator('[data-lightbox-source]')).toContainText('4eaf44ebd787');
});

test('a verified management token is remembered and reused on the next editor', async ({ page }) => {
  await fixture(page, false);
  await page.goto('/image-style-prompt-gallery');
  await page.getByRole('button', { name: '编辑标签', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Management token').fill('wrong');
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  await expect(dialog.getByLabel('Management token')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('style-gallery-upload-token'))).toBeNull();
  await dialog.getByLabel('Management token').fill('test-only');
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  await expect(dialog.getByRole('combobox')).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('style-gallery-upload-token'))).toBe('test-only');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '编辑标签', exact: true }).nth(1).click();
  await expect(dialog.getByRole('combobox')).toBeFocused();
});

for (const path of ['', `/${slug}`, '/examples']) {
  test(`image tag and count badges have matching geometry on ${path || 'preview'}`, async ({ page }) => {
    await fixture(page);
    await page.goto(`/image-style-prompt-gallery${path}`);
    const card = page
      .locator('[id^="style-gallery-preview-source-"], [id^="style-gallery-detail-source-"], [data-source-slug]')
      .first();
    await expect(card.locator('.gallery-tags-overlay .gallery-tag').first()).toBeVisible();
    const tagBox = await card.locator('.gallery-tags-overlay .gallery-tag').last().boundingBox();
    const badgeBox = await card.locator('.gallery-image-badge').first().boundingBox();
    if (!tagBox || !badgeBox) throw new Error('Image badges are missing');
    expect(Math.abs(tagBox.height - badgeBox.height)).toBeLessThan(0.5);
    expect(Math.abs(tagBox.y + tagBox.height - badgeBox.y - badgeBox.height)).toBeLessThan(0.5);
    if (path === `/${slug}`) {
      const dimensions = await card
        .locator('img')
        .first()
        .evaluate((img) => ({
          image: img.getBoundingClientRect().width,
          container: img.parentElement?.getBoundingClientRect().width ?? 0,
        }));
      expect(Math.abs(dimensions.image - dimensions.container)).toBeLessThan(0.5);
      await expect(page.locator('aside [data-gallery-original-prompt]')).toHaveCount(1);
    }
  });
}

test('detail Lightbox reports a failed tag request and retries without reloading the image', async ({ page }) => {
  await fixture(page);
  let failTags = true;
  await page.route('**/api/style-gallery/tags', (route) => (failTags ? route.fulfill({ status: 503 }) : route.fallback()));
  await page.goto(`/image-style-prompt-gallery/${sourceSlug}`);
  const card = page.locator('[id^="style-gallery-detail-example-"]').first();
  await expect(card.locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await card.getByRole('button').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: /标签暂时不可用/ })).toBeVisible();
  failTags = false;
  await dialog.getByRole('button', { name: /标签暂时不可用/ }).click();
  await expect(dialog.getByRole('link', { name: '#溶图', exact: true })).toBeVisible();
});

for (const source of ['2026-08-18-4a3484f05086', '2026-09-07-b392b6b4ea33']) {
  test(`detail visible columns align at the end of scrolling: ${source}`, async ({ page }) => {
    await fixture(page);
    await page.goto(`/image-style-prompt-gallery/${source}`);
    const article = page.locator('article[data-pagefind-body]');
    const aside = article.locator('aside');
    await expect(article.locator('astro-island[ssr]')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await aside
      .locator('img')
      .first()
      .evaluate((image: HTMLImageElement) => image.decode());
    await article.evaluate((element) => {
      const left = element.querySelector('aside')?.getBoundingClientRect();
      if (!left) throw new Error('Missing left column');
      window.scrollTo(0, element.getBoundingClientRect().bottom + scrollY - Math.min(innerHeight - 24, left.height + 24) + 80);
    });
    // Compare painted panels, not the grid wrapper: an invisible live region used to add 20px below the prompt.
    await expect
      .poll(async () => {
        const left = await aside.locator('[data-gallery-original-prompt]').boundingBox();
        const right = await article.locator(':scope > section .overflow-hidden').first().boundingBox();
        if (!left || !right) return Number.POSITIVE_INFINITY;
        return Math.abs(left.y + left.height - right.y - right.height);
      })
      .toBeLessThan(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(aside).toHaveCSS('position', 'static');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}

for (const path of ['', '/index', '/examples']) {
  test(`AND hashtags and untagged search stay local on ${path || 'preview'}`, async ({ page }) => {
    const state = await fixture(page);
    await page.goto(`/image-style-prompt-gallery${path}?q=${encodeURIComponent('#插画   #专辑')}`);
    await expect(page.getByRole('combobox', { name: '标签', exact: true })).toBeEnabled();
    await expect(page.locator('[data-gallery-selection]').locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
    await page.getByRole('button', { name: '批量标签', exact: true }).click();
    const output = page.locator('[data-gallery-selection] output');
    // The fixture's second source has both categories but no generated examples.
    await expect(output).toHaveText(path === '/examples' ? '0 / 0 个来源' : '0 / 1 个来源');
    const search = page.locator('input[placeholder]').filter({ visible: true }).first();
    await search.fill('#null');
    await expect(output).not.toHaveText('0 / 0 个来源');
    await expect(page.getByRole('button', { name: '#溶图', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '#插画', exact: true })).toHaveCount(0);
    expect(state.prompts()).toBe(0);
  });
}

test('bulk selection cancels link exits, preserves filters, and confirms an accepted exit only once', async ({ page }) => {
  await fixture(page);
  await page.goto('/image-style-prompt-gallery');
  await expect(page.locator('[data-gallery-selection]').locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await page.getByRole('button', { name: '批量标签', exact: true }).click();
  await page.locator('[data-gallery-selection]').getByRole('button', { name: '全选筛选结果', exact: true }).click();
  await page.getByRole('combobox', { name: '标签', exact: true }).selectOption('溶图');
  const output = page.locator('[data-gallery-selection] output');
  await expect(output).toHaveText('2 / 2 个来源');
  let dialogs = 0;
  const cancel = async (dialog: import('@playwright/test').Dialog) => {
    dialogs++;
    await dialog.dismiss();
  };
  page.on('dialog', cancel);
  const link = page.locator(`a[href$="/${slug}"]`).first();
  await link.click();
  await expect(output).toHaveText('2 / 2 个来源');
  expect(dialogs).toBe(1);
  page.off('dialog', cancel);
  page.on('dialog', async (dialog) => {
    dialogs++;
    await dialog.accept();
  });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/${slug}$`));
  expect(dialogs).toBe(2);
});

test('bulk selection cancels and then permits browser Back without losing history or selection', async ({ page }) => {
  await fixture(page);
  await page.goto(`/image-style-prompt-gallery/${slug}`);
  await page.locator('nav a[href="/image-style-prompt-gallery"]').click();
  await expect(page).toHaveURL(/\/image-style-prompt-gallery$/, { timeout: 60_000 });
  await expect(page.locator('[data-gallery-selection]').locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await page.getByRole('button', { name: '批量标签', exact: true }).click();
  await page.locator('[data-gallery-selection]').getByRole('button', { name: '全选筛选结果', exact: true }).click();
  const output = page.locator('[data-gallery-selection] output');
  const count = await output.textContent();
  const url = page.url();
  let dialogs = 0;
  const cancel = async (dialog: import('@playwright/test').Dialog) => {
    dialogs++;
    await dialog.dismiss();
  };
  page.on('dialog', cancel);
  await page.evaluate(() => history.back());
  await expect.poll(() => dialogs).toBe(1);
  await expect(page).toHaveURL(url);
  await expect(output).toHaveText(count ?? '');
  page.off('dialog', cancel);
  page.on('dialog', async (dialog) => {
    dialogs++;
    await dialog.accept();
  });
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(new RegExp(`/${slug}$`));
  expect(dialogs).toBe(2);
});

test('bulk selection uses native confirmation for refresh and removes it after exiting selection', async ({ page }) => {
  await fixture(page);
  await page.goto('/image-style-prompt-gallery');
  await expect(page.locator('[data-gallery-selection]').locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await page.getByRole('button', { name: '批量标签', exact: true }).click();
  await page.locator('[data-gallery-selection]').getByRole('button', { name: '全选筛选结果', exact: true }).click();
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs++;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
  });
  await page.evaluate(() => location.reload());
  await expect.poll(() => dialogs).toBe(1);
  await expect(page.locator('[data-gallery-selection]').getByRole('button', { name: '退出多选', exact: true })).toBeVisible();
  await page.locator('[data-gallery-selection]').getByRole('button', { name: '退出多选', exact: true }).click();
  await page.reload();
  expect(dialogs).toBe(1);
});

test('bulk selection guards Forward and leaves new tabs and same-page anchors alone', async ({ page }) => {
  await fixture(page);
  await page.goto(`/image-style-prompt-gallery?tag=${encodeURIComponent('溶图')}`);
  await page.locator(`a[href$="/${slug}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/${slug}$`));
  await page.goBack();
  await expect(page.locator('[data-gallery-selection]').locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
  await page.getByRole('button', { name: '批量标签', exact: true }).click();
  await page.locator('[data-gallery-selection]').getByRole('button', { name: '全选筛选结果', exact: true }).click();
  const output = page.locator('[data-gallery-selection] output');
  const count = await output.textContent();
  const url = page.url();
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  await page.evaluate(() => history.forward());
  await expect.poll(() => dialogs).toBe(1);
  await expect(page).toHaveURL(url);
  await expect(output).toHaveText(count ?? '');
  const sourceLink = page.locator(`a[href$="/${slug}"]`).first();
  await sourceLink.evaluate((el) => el.setAttribute('target', '_blank'));
  const popupPromise = page.waitForEvent('popup');
  await sourceLink.click();
  const popup = await popupPromise;
  await popup.close();
  expect(dialogs).toBe(1);
  await page.evaluate(() => {
    const anchor = document.createElement('a');
    anchor.href = '#gallery-test-anchor';
    anchor.textContent = 'Test anchor';
    document.querySelector('[data-gallery-selection]')?.append(anchor);
  });
  await page.getByRole('link', { name: 'Test anchor', exact: true }).click();
  await expect(page).toHaveURL(/#gallery-test-anchor$/);
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(url);
  expect(dialogs).toBe(1);
  await expect(output).toHaveText(count ?? '');
});

test('the editor rejects the reserved null category before making a write', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/image-style-prompt-gallery');
  await page.getByRole('button', { name: '编辑标签', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await dialog.getByRole('combobox').fill('#NULL');
  await dialog.getByRole('combobox').press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('null 为保留词');
  await dialog.getByRole('button', { name: '保存标签', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('null 为保留词');
  expect(state.writes).toHaveLength(0);
});

for (const path of ['', '/index', '/examples']) {
  test(`bulk replace, selective removal and clearing require confirmation on ${path || 'preview'}`, async ({ page }) => {
    if (path === '/index') await page.setViewportSize({ width: 390, height: 844 });
    const state = await fixture(page);
    await page.goto(`/image-style-prompt-gallery${path}?q=${encodeURIComponent('#溶图')}`);
    await expect(page.locator('[data-gallery-selection]').locator('xpath=ancestor::astro-island')).not.toHaveAttribute('ssr');
    await page.getByRole('button', { name: '批量标签', exact: true }).click();
    await page.locator('[data-gallery-selection]').getByRole('button', { name: '全选筛选结果', exact: true }).click();
    const edit = page.locator('[data-gallery-selection]').getByRole('button', { name: '批量编辑标签', exact: true });
    await edit.click();
    const dialog = page.getByRole('dialog', { name: /编辑标签/ });
    await expect(dialog.getByRole('radio', { name: '添加', exact: true })).toBeChecked();
    await dialog.getByRole('radio', { name: '覆盖', exact: true }).check();
    await dialog.getByRole('combobox').fill('现实');
    await dialog.getByRole('combobox').press('Enter');
    await dialog.getByRole('combobox').fill('溶图');
    await dialog.getByRole('combobox').press('Enter');
    await expect(dialog.locator('[data-gallery-tag-impact]')).toContainText('移除 0');
    await dialog.getByRole('button', { name: '覆盖标签', exact: true }).click();
    await expect(dialog.getByRole('group', { name: '确认批量修改' })).toBeVisible();
    expect(state.writes).toHaveLength(0);
    await dialog.getByRole('button', { name: '返回编辑', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '移除 现实', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '覆盖标签', exact: true }).click();
    await dialog.getByRole('button', { name: '确认应用', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const replacement = state.writes[0] as {
      slugs: string[];
      tags: string[];
      mode: string;
      previousTagsBySlug: Record<string, string[]>;
    };
    expect(replacement.mode).toBe('replace');
    expect(replacement.tags).toEqual(['现实', '溶图']);
    expect(Object.keys(replacement.previousTagsBySlug)).toEqual(replacement.slugs);
    expect(Object.values(replacement.previousTagsBySlug).every((tags) => tags.join() === '溶图')).toBe(true);
    // The selection remains available after a write. Removing one category leaves the other intact.
    await edit.click();
    await dialog.getByRole('radio', { name: '移除', exact: true }).check();
    await expect(dialog.getByRole('option', { name: /#专辑/ })).toHaveCount(0);
    await dialog.getByRole('combobox').fill('现实');
    await dialog.getByRole('combobox').press('Tab');
    await dialog.getByRole('button', { name: '移除标签', exact: true }).click();
    expect(state.writes).toHaveLength(1);
    await dialog.getByRole('button', { name: '确认应用', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(state.writes[1]).toEqual({ slugs: replacement.slugs, tags: ['现实'], mode: 'remove' });
    await edit.click();
    await dialog.getByRole('radio', { name: '覆盖', exact: true }).check();
    await dialog.getByRole('button', { name: '清空全部标签', exact: true }).click();
    expect(state.writes).toHaveLength(2);
    await dialog.getByRole('button', { name: '确认应用', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(state.writes[2]).toEqual({
      slugs: replacement.slugs,
      tags: [],
      mode: 'replace',
      previousTagsBySlug: replacement.previousTagsBySlug,
    });
    await expect(edit).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}
