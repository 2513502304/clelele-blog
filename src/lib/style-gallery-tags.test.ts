import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { APIContext, AstroCookies } from 'astro';
import { GET, PUT } from '../pages/api/style-gallery/tags';
import { setStyleGallerySession } from './style-gallery-github-auth';
import { STYLE_GALLERY_PLATFORMS } from './style-gallery-platforms';
import { invalidateStyleGalleryStoreCache } from './style-gallery-store';
import { GalleryTagWriteError, galleryTagMutationSchema, getGalleryTagIndex, setGalleryTags } from './style-gallery-tag-store';
import { galleryTagMatches, getGalleryTagVocabulary, normalizeGalleryTag } from './style-gallery-tags';

it('matches every exact hashtag across whitespace and reserves #null for untagged sources', () => {
  assert.equal(galleryTagMatches(['溶图', '现实'], '  #溶图 \t\n　#现实  '), true);
  assert.equal(galleryTagMatches(['溶图'], '#溶图 #现实'), false);
  assert.equal(galleryTagMatches(['现实插画'], '#现实'), false);
  assert.equal(galleryTagMatches(['oil painting', '现实'], '#Oil  Painting #现实'), true);
  assert.equal(galleryTagMatches([], '#null'), true);
  assert.equal(galleryTagMatches(['插画'], '#null'), false);
  assert.equal(galleryTagMatches([], '#null #插画'), false);
  assert.equal(galleryTagMatches([], '#null #null'), true);
  assert.equal(galleryTagMatches([], '#'), false);
  assert.equal(galleryTagMatches(['插画'], '#插画 #'), false);
});

const originalFetch = globalThis.fetch;
const envKeys = [
  'STYLE_GALLERY_UPLOAD_TOKEN',
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
      headers: {
        'content-type': 'application/json',
        ...(origin ? { origin } : {}),
        ...(auth ? { authorization: 'Bearer test-only' } : {}),
      },
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
  it('rejects GitHub-only sessions and missing/foreign origins before touching storage', async () => {
    const beforeWrites = writes;
    const githubOnly = context({});
    githubOnly.request.headers.delete('authorization');
    assert.equal((await PUT(githubOnly)).status, 401);
    const wrongToken = context({});
    wrongToken.request.headers.set('authorization', 'Bearer wrong-token');
    assert.equal((await PUT(wrongToken)).status, 401);
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
  it('adds tags to all selected sources atomically while preserving their individual categories', async () => {
    stored = JSON.stringify({ version: 1, items: { 'source-one': ['溶图'], 'source-two': ['插画'] } });
    const response = await PUT(context({ slugs: ['source-one', 'source-two', 'source-one'], tags: ['专辑'] }));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).items, { 'source-one': ['专辑', '溶图'], 'source-two': ['专辑', '插画'] });
    assert.equal(writes, 1);
    await setGalleryTags({ slugs: ['source-one', 'source-two'], tags: ['专辑'] });
    assert.equal(writes, 1, 'replaying the batch is write-free');
  });
  it('reports only actually changed sources and keeps counts out of persistent metadata', async () => {
    stored = JSON.stringify({ version: 1, items: { 'source-one': ['插画'] } });
    const first = await setGalleryTags({ slugs: ['source-one', 'source-two'], tags: ['插画'] });
    assert.equal(first.changedSources, 1);
    assert.equal(JSON.parse(stored).changedSources, undefined);
    const replay = await setGalleryTags({ slugs: ['source-one', 'source-two'], tags: ['插画'] });
    assert.equal(replay.changedSources, 0);
  });
  it('removes chosen labels across a batch while retaining unrelated labels', async () => {
    stored = JSON.stringify({ version: 1, items: { 'source-one': ['插画', '溶图'], 'source-two': ['插画'] } });
    const result = await PUT(context({ slugs: ['source-one', 'source-two'], mode: 'remove', tags: ['插画'] }));
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).items, { 'source-one': ['溶图'] });
    assert.equal(writes, 1);
  });
  it('replaces a whole batch from a fresh base and supports clearing all labels', async () => {
    const previousTagsBySlug = { 'source-one': ['溶图'], 'source-two': ['插画'] };
    stored = JSON.stringify({ version: 1, items: previousTagsBySlug });
    const input = { slugs: ['source-one', 'source-two'], mode: 'replace', tags: ['现实'], previousTagsBySlug };
    const result = await PUT(context(input));
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).items, { 'source-one': ['现实'], 'source-two': ['现实'] });
    assert.equal((await PUT(context(input))).status, 200, 'a repeated successful replacement is idempotent');
    assert.equal(writes, 1);
    const clear = await PUT(
      context({ ...input, tags: [], previousTagsBySlug: { 'source-one': ['现实'], 'source-two': ['现实'] } }),
    );
    assert.equal(clear.status, 200);
    assert.deepEqual((await clear.json()).items, {});
  });
  it('rejects the entire replacement if a selected source changes during the conditional write', async () => {
    conflict = true;
    const response = await PUT(
      context({
        slugs: ['source-one', 'source-two'],
        mode: 'replace',
        tags: ['现实'],
        previousTagsBySlug: { 'source-one': [], 'source-two': [] },
      }),
    );
    assert.equal(response.status, 409);
    assert.deepEqual(JSON.parse(stored ?? '{}').items, { 'source-two': ['插画'] });
    assert.equal(writes, 1, 'only the failed conditional write was attempted');
  });
  it('replays removals against fresh storage without losing concurrent unrelated categories', async () => {
    stored = JSON.stringify({ version: 1, items: { 'source-one': ['溶图'] } });
    conflict = true;
    const response = await PUT(context({ slugs: ['source-one', 'source-two'], mode: 'remove', tags: ['溶图'] }));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).items, { 'source-two': ['插画'] });
    assert.equal(writes, 1);
  });
  it('validates mutation modes, replacement bases and empty sets before storage writes', async () => {
    for (const extra of [
      { mode: 'unknown', tags: ['插画'] },
      { mode: 'add', tags: [] },
      { mode: 'remove', tags: [] },
      { mode: 'replace', tags: ['插画'] },
      { mode: 'replace', tags: [], previousTagsBySlug: {} },
    ]) {
      assert.equal((await PUT(context({ slugs: ['source-one'], ...extra }))).status, 400);
    }
    assert.equal(writes, 0);
    assert.equal(
      galleryTagMutationSchema.safeParse({
        slugs: ['source-one'],
        mode: 'remove',
        tags: Array.from({ length: 100 }, (_, i) => `tag${i}`),
      }).success,
      true,
    );
  });
  it('replays a batch union after a concurrent write without deleting new tags', async () => {
    conflict = true;
    const next = await setGalleryTags({ slugs: ['source-one', 'source-two'], tags: ['溶图'] });
    assert.deepEqual(next.items, { 'source-one': ['溶图'], 'source-two': ['插画', '溶图'] });
    assert.equal(writes, 2);
  });
  it('rejects an entire batch before writing if any source is unknown or exceeds its tag limit', async () => {
    stored = JSON.stringify({ version: 1, items: { 'source-two': Array.from({ length: 12 }, (_, i) => `tag${i}`) } });
    const original = stored;
    for (const slugs of [
      ['source-one', 'source-two'],
      ['source-one', 'missing'],
    ]) {
      await assert.rejects(setGalleryTags({ slugs, tags: ['插画'] }), GalleryTagWriteError);
      assert.equal(writes, 0);
      assert.equal(stored, original);
    }
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
    assert.equal((await PUT(context({ junk: 'x'.repeat(2_000_001) }))).status, 413);
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

it('rejects normalized null categories in single and bulk mutation schemas', () => {
  for (const tag of ['null', '#NULL', ' ＃ＮＵＬＬ ']) {
    assert.equal(galleryTagMutationSchema.safeParse({ slug: 'source-one', tags: [tag], previousTags: [] }).success, false);
    assert.equal(galleryTagMutationSchema.safeParse({ slugs: ['source-one'], tags: [tag] }).success, false);
  }
  assert.equal(galleryTagMutationSchema.safeParse({ slug: 'source-one', tags: [], previousTags: [] }).success, true);
});
