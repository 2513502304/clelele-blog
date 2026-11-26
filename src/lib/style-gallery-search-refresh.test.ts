import assert from 'node:assert/strict';
import { it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { APIContext } from 'astro';
import { GET } from '../pages/api/style-gallery/search';
import { STYLE_GALLERY_PLATFORMS } from './style-gallery-platforms';
import {
  getStyleGallerySearchCacheState,
  invalidateStyleGalleryStoreCache,
  putStyleGalleryCatalog,
} from './style-gallery-store';

it('serves an expired search while one background check runs, and honors local writes and edge cache rules', async (t) => {
  const previous = {
    HF_S3_ACCESS_KEY_ID: process.env.HF_S3_ACCESS_KEY_ID,
    HF_S3_SECRET_ACCESS_KEY: process.env.HF_S3_SECRET_ACCESS_KEY,
  };
  Object.assign(process.env, { HF_S3_ACCESS_KEY_ID: 'TEST', HF_S3_SECRET_ACCESS_KEY: 'test' });
  let tick = Date.now();
  t.mock.method(Date, 'now', () => tick);
  const stamp = new Date(tick).toISOString();
  const catalog = {
    version: 5 as const,
    updatedAt: stamp,
    items: [],
    modelTargets: STYLE_GALLERY_PLATFORMS.map((p) => p.label),
  };
  let getCount = 0;
  let headCount = 0;
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  t.after(() => {
    release();
    invalidateStyleGalleryStoreCache();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = { etag: '"fixture"' };
    if (init?.method === 'HEAD') {
      headCount++;
      await gate;
      return new Response(null, { headers });
    }
    if (init?.method === 'PUT') return new Response(null, { headers });
    getCount++;
    const body = url.pathname.endsWith('catalog-v5.json')
      ? catalog
      : url.pathname.endsWith('prompt-search-index.json')
        ? { version: 1, updatedAt: stamp, entries: {} }
        : { version: 2, updatedAt: stamp, groups: [] };
    return Response.json(body, { headers });
  });
  invalidateStyleGalleryStoreCache();
  const search = () => GET({ url: new URL('http://localhost/api/style-gallery/search?q=test') } as APIContext);
  const first = await search();
  assert.equal(first.status, 200);
  assert.ok(first.headers.has('vercel-cdn-cache-control'));
  assert.equal(getCount, 3);
  tick += 31_000;
  const responses = await Promise.race([
    Promise.all(Array.from({ length: 8 }, search)),
    delay(1000).then(() => {
      throw Error('A search waited for storage revalidation');
    }),
  ]);
  assert.ok(responses.every((response) => response.headers.get('cache-control') === 'private, no-store'));
  assert.equal(headCount, 3);
  assert.equal(getCount, 3);
  release();
  for (let i = 0; i < 20 && (getStyleGallerySearchCacheState()?.expiresAt ?? 0) <= tick; i++) await delay(5);
  assert.ok((await search()).headers.has('vercel-cdn-cache-control'));
  assert.equal(getCount, 3);
  const updatedAt = new Date(tick).toISOString();
  await putStyleGalleryCatalog({ ...catalog, updatedAt });
  assert.equal((await (await search()).json()).revision.split('/')[0], updatedAt);
});
