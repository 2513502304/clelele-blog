import assert from 'node:assert/strict';
import { it } from 'node:test';
import { STYLE_GALLERY_PLATFORMS } from './style-gallery-platforms';
import { getStyleGalleryCatalog, invalidateStyleGalleryStoreCache, putStyleGalleryCatalog } from './style-gallery-store';

it('shares cold catalog reads, bypasses for fresh reads and prevents old requests from replacing written data', async () => {
  const fetchBefore = globalThis.fetch;
  const config = { HF_S3_ACCESS_KEY_ID: 'TEST', HF_S3_SECRET_ACCESS_KEY: 'test-secret' };
  const previous = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]));
  Object.assign(process.env, config);
  const catalog = {
    version: 5 as const,
    updatedAt: '2026-09-15T00:00:00Z',
    modelTargets: STYLE_GALLERY_PLATFORMS.map((p) => p.label),
    items: [],
  };
  const releases: Array<(response: Response) => void> = [];
  let reads = 0;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'PUT') return new Response(null, { headers: { etag: '"new"' } });
    reads++;
    return new Promise<Response>((resolve) => releases.push(resolve));
  };
  const release = (value = catalog) => releases.shift()?.(Response.json(value));
  try {
    invalidateStyleGalleryStoreCache();
    const concurrent = Array.from({ length: 8 }, () => getStyleGalleryCatalog());
    assert.equal(reads, 1);
    release();
    const values = await Promise.all(concurrent);
    assert.ok(values.every((value) => value === values[0]));
    await getStyleGalleryCatalog();
    assert.equal(reads, 1);
    const fresh = getStyleGalleryCatalog({ fresh: true });
    assert.equal(reads, 2);
    release();
    await fresh;
    invalidateStyleGalleryStoreCache();
    const old = getStyleGalleryCatalog();
    const next = { ...catalog, updatedAt: '2026-09-15T01:00:00Z' };
    await putStyleGalleryCatalog(next);
    release();
    await old;
    assert.equal((await getStyleGalleryCatalog()).updatedAt, next.updatedAt);
    // Failed shared reads must detach so an ordinary retry can recover.
    invalidateStyleGalleryStoreCache();
    const failed = getStyleGalleryCatalog();
    releases.shift()?.(new Response('invalid json'));
    await assert.rejects(failed);
    const retry = getStyleGalleryCatalog();
    release(next);
    assert.equal((await retry).updatedAt, next.updatedAt);
  } finally {
    globalThis.fetch = fetchBefore;
    invalidateStyleGalleryStoreCache();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
