import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { APIContext, AstroCookies } from 'astro';
import { GET, PUT } from '../pages/api/style-gallery/tags';
import { setStyleGallerySession } from './style-gallery-github-auth';
import { STYLE_GALLERY_PLATFORMS } from './style-gallery-platforms';
import { invalidateStyleGalleryStoreCache } from './style-gallery-store';
import { GalleryTagWriteError, galleryTagMutationSchema, getGalleryTagIndex, setGalleryTags } from './style-gallery-tag-store';
import { getGalleryTagVocabulary, normalizeGalleryTag } from './style-gallery-tags';

const originalFetch = globalThis.fetch;
const envKeys = [
  'HF_S3_ACCESS_KEY_ID',
  'HF_S3_SECRET_ACCESS_KEY',
  'STYLE_GALLERY_SESSION_SECRET',
  'STYLE_GALLERY_GITHUB_CLIENT_ID',
  'STYLE_GALLERY_GITHUB_CLIENT_SECRET',
  'STYLE_GALLERY_GITHUB_REDIRECT_URI',
] as const;
const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
let stored: string | null = null;
let etag = '"one"';
let writes = 0;
let conflict = false;
const catalog = {
  version: 5,
  updatedAt: '2026-09-14T00:00:00Z',
  modelTargets: STYLE_GALLERY_PLATFORMS.map((platform) => platform.label),
  items: ['source-one', 'source-two'].map((slug) => ({
    slug,
    title: slug,
    date: '2026-09-14T00:00:00Z',
    sourceImage: `/api/style-gallery/image/source/${'a'.repeat(12)}.webp`,
    promptExcerpt: 'test',
    promptRevision: 'a'.repeat(64),
    imageHash: 'a'.repeat(64),
    promptCount: 1,
    imageCount: 1,
    exampleCount: 0,
  })),
};
function cookies(auth = false): AstroCookies {
  const jar = new Map<string, string>();
  const result = {
    get: (key: string) => (jar.has(key) ? { value: jar.get(key) } : undefined),
    set: (key: string, value: string) => jar.set(key, value),
  } as unknown as AstroCookies;
  if (auth)
    setStyleGallerySession(result, new URL('https://blog.example'), {
      id: 7,
      login: 'tester',
      avatarUrl: 'https://github.com/a.png',
      profileUrl: 'https://github.com/tester',
    });
  return result;
}
function context(body: unknown, auth = true, origin: string | null = 'https://blog.example'): APIContext {
  return {
    url: new URL('https://blog.example/api/style-gallery/tags'),
    cookies: cookies(auth),
    request: new Request('https://blog.example/api/style-gallery/tags', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    }),
  } as APIContext;
}
describe('shared gallery categories', () => {
  before(() => {
    for (const key of envKeys) process.env[key] = key.includes('SESSION_SECRET') ? 'test-secret-'.repeat(4) : 'test-only';
    invalidateStyleGalleryStoreCache();
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('catalog-v5.json')) return Response.json(catalog);
      if (url.includes('tags-v1.json')) {
        if (init?.method === 'PUT') {
          writes++;
          const conditions = new Headers(init.headers);
          if (conflict) {
            conflict = false;
            stored = JSON.stringify({ version: 1, items: { 'source-two': ['插画'] } });
            etag = '"two"';
            return new Response(null, { status: 412 });
          }
          assert.equal(conditions.get(stored ? 'if-match' : 'if-none-match'), stored ? etag : '*');
          stored = new TextDecoder().decode(init.body as ArrayBuffer);
          etag = '"updated"';
          return new Response(null, { headers: { etag } });
        }
        return new Response(stored, { status: stored ? 200 : 404, headers: { etag } });
      }
      throw new Error(`Unexpected storage request: ${new URL(url).pathname}`);
    };
  });
  beforeEach(() => {
    stored = null;
    etag = '"one"';
    writes = 0;
    conflict = false;
  });
  after(() => {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  it('normalizes categories and rejects invisible labels, markup and oversized sets', () => {
    assert.equal(normalizeGalleryTag(' ＃ＡＩ  插画 '), 'ai 插画');
    assert.deepEqual(galleryTagMutationSchema.parse({ slug: 'source-one', tags: ['#插画', '插画'], previousTags: [] }).tags, [
      '插画',
    ]);
    for (const tags of [[''], ['x'.repeat(25)], ['<script>'], ['零\u200b宽'], Array.from({ length: 13 }, (_, i) => String(i))])
      assert.equal(galleryTagMutationSchema.safeParse({ slug: 'source-one', tags, previousTags: [] }).success, false);
  });
  it('supports an empty installation without migrating any item', async () => {
    assert.deepEqual(await getGalleryTagIndex(), { version: 1, items: {} });
  });
  it('isolates tag invalidation from SSR and never republishes another worker’s stale snapshot', async () => {
    const first = await GET(context({}));
    assert.equal(first.headers.get('vercel-cache-tag'), 'style-gallery-tags');
    assert.deepEqual(await first.json(), { version: 1, items: {} });
    stored = JSON.stringify({ version: 1, items: { 'source-two': ['插画'] } });
    assert.deepEqual(await (await GET(context({}))).json(), JSON.parse(stored));
    stored = null;
  });
  it('rejects guests and missing/foreign origins before touching storage', async () => {
    const beforeWrites = writes;
    assert.equal((await PUT(context({}, false))).status, 401);
    assert.equal((await PUT(context({}, true, 'https://evil.example'))).status, 403);
    assert.equal((await PUT(context({}, true, null))).status, 403);
    const ctx = context({}, false);
    ctx.url.searchParams.set('edit', '1');
    assert.equal((await GET(ctx)).status, 401);
    assert.equal(writes, beforeWrites);
  });
  it('replays independent edits without overwriting them, then detects edits to the same source', async () => {
    conflict = true;
    const response = await PUT(context({ slug: 'source-one', tags: ['溶图'], previousTags: [] }));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).items, { 'source-one': ['溶图'], 'source-two': ['插画'] });
    await assert.rejects(
      setGalleryTags({ slug: 'source-one', tags: ['专辑'], previousTags: [] }),
      (e: unknown) => e instanceof GalleryTagWriteError && e.status === 409,
    );
    const beforeWrites = writes;
    await setGalleryTags({ slug: 'source-one', tags: ['溶图'], previousTags: [] });
    assert.equal(writes, beforeWrites, 'retrying a successful save is write-free');
  });
  it('removes empty assignments and unused vocabulary without changing other sources', async () => {
    stored = JSON.stringify({ version: 1, items: { 'source-one': ['溶图'], 'source-two': ['插画'] } });
    etag = '"remove-fixture"';
    const result = await setGalleryTags({ slug: 'source-one', tags: [], previousTags: ['溶图'] });
    assert.deepEqual(result.items, { 'source-two': ['插画'] });
    assert.deepEqual(getGalleryTagVocabulary(result), [{ tag: '插画', count: 1 }]);
    await assert.rejects(
      setGalleryTags({ slug: 'nonexistent', tags: ['插画'], previousTags: [] }),
      (e: unknown) => e instanceof GalleryTagWriteError && e.status === 404,
    );
  });
  it('rejects oversized requests and more than 100 shared categories', async () => {
    assert.equal((await PUT(context({ junk: 'x'.repeat(9000) }))).status, 413);
    stored = JSON.stringify({
      version: 1,
      items: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`item-${i}`, [`category${i}`]])),
    });
    await assert.rejects(
      setGalleryTags({ slug: 'source-one', tags: ['new-category'], previousTags: [] }),
      (e: unknown) => e instanceof GalleryTagWriteError && e.status === 400,
    );
  });
});
