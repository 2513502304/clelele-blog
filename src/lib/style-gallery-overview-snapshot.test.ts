import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { getOverviewSnapshot } from './style-gallery-overview-snapshot';
import { STYLE_GALLERY_PLATFORMS } from './style-gallery-platforms';

test('cold card snapshots require both source revisions and an intact payload', async (t) => {
  const slug = '2026-11-13-example',
    hash = 'a'.repeat(64),
    date = '2026-11-13T00:00:00Z';
  const parent = {
    slug,
    title: 'Original',
    date,
    sourceImage: '/api/style-gallery/image/source/aaaaaaaaaaaa.png',
    imageHash: hash,
    imageCount: 1,
    exampleCount: 1,
    promptCount: 1,
    promptRevision: hash,
    promptExcerpt: 'test',
  };
  const entry = {
    id: 'example',
    src: `/api/style-gallery/image/examples/images/${hash}.png`,
    model: 'PixAI',
    uploadedAt: date,
    likedBy: [] as number[],
    note: 'Exact full note',
  };
  let catalogVersion = 'a',
    indexVersion = 'a',
    cacheBody: Buffer | undefined,
    writes = 0,
    fullReads = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.hostname, 'snapshot.invalid');
    const method = init?.method ?? 'GET';
    if (url.pathname.endsWith('example-overview-v1.json.gz')) {
      if (method === 'PUT') {
        cacheBody = Buffer.from(await new Response(init?.body).arrayBuffer());
        writes++;
        return new Response(null, { headers: { etag: '"snapshot"' } });
      }
      return cacheBody
        ? new Response(Uint8Array.from(cacheBody), { headers: { etag: '"snapshot"' } })
        : new Response(null, { status: 404 });
    }
    const catalog = url.pathname.endsWith('metadata/catalog-v5.json');
    assert.ok(catalog || url.pathname.endsWith('examples/index-v2.json'));
    const headers = { etag: `"${catalog ? catalogVersion : indexVersion}"` };
    if (method === 'HEAD') return new Response(null, { headers });
    fullReads++;
    return Response.json(
      catalog
        ? { version: 5, updatedAt: date, modelTargets: STYLE_GALLERY_PLATFORMS.map((p) => p.label), items: [parent] }
        : { version: 2, updatedAt: date, groups: [{ sourceSlug: slug, examples: [entry] }] },
      { headers },
    );
  });
  for (const [key, value] of Object.entries({
    HF_S3_ENDPOINT: 'https://snapshot.invalid',
    HF_S3_ACCESS_KEY_ID: 'fixture',
    HF_S3_SECRET_ACCESS_KEY: 'fixture',
  })) {
    const old = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (old === undefined) delete process.env[key];
      else process.env[key] = old;
    });
  }
  async function rebuild(count: number) {
    const result = await getOverviewSnapshot();
    assert.equal(result.source, 'rebuild');
    for (let i = 0; writes < count && i < 50; i++) await delay(5);
    assert.equal(writes, count);
    return result.payload;
  }
  const first = await rebuild(1);
  assert.ok(cacheBody);
  const original = cacheBody;
  assert.equal((await getOverviewSnapshot()).source, 'memory');
  parent.title = 'Renamed';
  catalogVersion = 'b';
  assert.equal((await rebuild(2)).sources[0].sourceTitle, 'Renamed');
  parent.title = 'Original';
  catalogVersion = 'a';
  cacheBody = original;
  fullReads = 0;
  const cold = await getOverviewSnapshot();
  assert.equal(cold.source, 'snapshot');
  assert.deepEqual(cold.payload, first);
  assert.equal(fullReads, 0);
  entry.likedBy = [17];
  indexVersion = 'b';
  assert.equal((await rebuild(3)).cards[0][5], 1);
  entry.likedBy = [];
  indexVersion = 'a';
  const damaged = JSON.parse(gunzipSync(original).toString());
  damaged.payload.cards = [];
  cacheBody = gzipSync(JSON.stringify(damaged));
  assert.deepEqual(await rebuild(4), first);
});
