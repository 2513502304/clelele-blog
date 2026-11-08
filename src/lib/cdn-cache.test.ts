import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { invalidateCdnTags } from './cdn-cache';

const original = { ...process.env };
afterEach(() => {
  mock.restoreAll();
  for (const key of ['BLOG_CACHE_INVALIDATION_URL', 'BLOG_CACHE_INVALIDATION_TOKEN', 'DEPLOY_TARGET']) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

test('container invalidation cannot silently fall back to a Vercel no-op', async () => {
  process.env.DEPLOY_TARGET = 'cloudflare-container';
  delete process.env.BLOG_CACHE_INVALIDATION_URL;
  await assert.rejects(invalidateCdnTags('style-gallery-lists'), /endpoint is missing/);
});

test('Cloudflare bridge sends authenticated tag scope and surfaces failed invalidation', async () => {
  process.env.BLOG_CACHE_INVALIDATION_URL = 'https://blog.example/_internal/cache';
  process.env.BLOG_CACHE_INVALIDATION_TOKEN = 'test-only';
  const fetchMock = mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { mode: 'purge', tags: ['hpoi-collection'] });
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-only');
    assert.equal(init?.redirect, 'error');
    return new Response(null, { status: 503 });
  });
  await assert.rejects(invalidateCdnTags(['hpoi-collection', 'hpoi-collection'], 'purge'), /503/);
  assert.equal(fetchMock.mock.callCount(), 1);
});
