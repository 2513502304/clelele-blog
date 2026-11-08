import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canUsePublicCache, forBrowser, forEdgeCache, parseInvalidation } from './cache-policy.mjs';

test('shared caching excludes sessions, credentials, ranges and mutations', () => {
  const url = 'https://blog.example/api/style-gallery/catalog';
  assert.equal(canUsePublicCache(new Request(url)), true);
  for (const headers of [{ cookie: 'session=private' }, { authorization: 'Bearer secret' }, { range: 'bytes=0-1' }]) {
    assert.equal(canUsePublicCache(new Request(url, { headers })), false);
  }
  assert.equal(canUsePublicCache(new Request(url, { method: 'POST' })), false);
});

test('edge lifetime and tags stay separate from browser revalidation', async () => {
  const edge = forEdgeCache(
    new Response('catalog', {
      headers: {
        'cache-control': 'public, max-age=0, must-revalidate',
        'vercel-cdn-cache-control': 'public, s-maxage=86400, stale-while-revalidate=2592000',
        'vercel-cache-tag': 'style-gallery-lists',
      },
    }),
  );
  assert.equal(edge.headers.get('cache-tag'), 'style-gallery-lists');
  assert.match(edge.headers.get('cache-control'), /s-maxage=86400/);
  const browser = forBrowser(edge);
  assert.equal(browser.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.equal(browser.headers.has('cache-tag'), false);
  assert.equal(browser.headers.has('x-blog-browser-cache-control'), false);
  assert.equal(await browser.text(), 'catalog');
});

test('private responses, session cookies and errors cannot become public cache entries', () => {
  for (const options of [
    { headers: { 'cache-control': 'private, no-store', 'vercel-cdn-cache-control': 'public, max-age=60' } },
    { headers: { 'set-cookie': 'session=private', 'vercel-cdn-cache-control': 'public, max-age=60' } },
    { status: 503, headers: { 'cache-control': 'public, max-age=60' } },
  ]) {
    const edge = forEdgeCache(new Response('response', options));
    assert.equal(edge.headers.get('cache-control'), 'private, no-store');
    assert.equal(forBrowser(edge).headers.get('cache-control'), 'private, no-store');
  }
});

test('signed-image redirect TTL survives while unspecified redirects remain private', () => {
  const headers = {
    location: 'https://assets.example/immutable-image?signature=synthetic',
    'cache-control': 'public, max-age=300',
    'vercel-cdn-cache-control': 'public, s-maxage=300',
  };
  const edge = forEdgeCache(new Response(null, { status: 302, headers }));
  assert.equal(edge.headers.get('cache-control'), 'public, s-maxage=300');
  const browser = forBrowser(edge);
  assert.equal(browser.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(browser.headers.get('location'), headers.location);
  const login = forEdgeCache(new Response(null, { status: 302, headers: { location: '/login' } }));
  assert.equal(login.headers.get('cache-control'), 'private, no-store');
  const personalized = forEdgeCache(new Response(null, { status: 302, headers: { ...headers, 'set-cookie': 'sid=test' } }));
  assert.equal(personalized.headers.get('cache-control'), 'private, no-store');
});

test('invalidation validates scope, deduplicates tags, and distinguishes hard purge', () => {
  assert.deepEqual(parseInvalidation({ mode: 'purge', tags: ['hpoi-collection', 'hpoi-collection'] }), {
    mode: 'purge',
    tags: ['hpoi-collection'],
  });
  for (const body of [
    null,
    { mode: 'all', tags: ['one'] },
    { mode: 'purge', tags: [] },
    { mode: 'purge', tags: ['one,two'] },
    { mode: 'purge', tags: Array(129).fill('one') },
  ]) {
    assert.throws(() => parseInvalidation(body));
  }
});
