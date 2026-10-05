import assert from 'node:assert/strict';
import { it } from 'node:test';
import { GET } from '../../pages/api/site-assets/[asset]';

it('shares a stable cached image across banner slots and validates history before serving bytes', async () => {
  const settings = {
    HF_S3_ENDPOINT: 'https://profile-assets-test.invalid',
    HF_S3_ACCESS_KEY_ID: 'test',
    HF_S3_SECRET_ACCESS_KEY: 'test',
  };
  const prior = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const originalFetch = globalThis.fetch;
  const file = `${'d'.repeat(64)}.png`;
  const key = `images/${file}`;
  let imageReads = 0;
  const profile = {
    version: 1,
    revision: '0b6964a3-f2db-4555-9383-d600bcaa448d',
    updatedAt: '2026-10-05T00:00:00Z',
    name: 'test',
    signature: '',
    links: [],
    assets: { avatar: key, home: key },
    history: [{ key, name: 'test.png', width: 1, height: 1, uploadedAt: '2026-10-05T00:00:00Z' }],
  };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'profile-assets-test.invalid');
    if (url.pathname.endsWith('profile.v1.json')) return Response.json(profile, { headers: { ETag: '"test"' } });
    imageReads++;
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
  };
  const get = (asset: string, etag?: string) =>
    GET({
      params: { asset },
      request: new Request(`https://blog.test/api/site-assets/${asset}`, { headers: etag ? { 'if-none-match': etag } : {} }),
    } as unknown as Parameters<typeof GET>[0]);
  try {
    for (const slot of ['home', 'weekly', 'hpoi']) {
      const response = await get(slot);
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), `/api/site-assets/${file}`);
    }
    const image = await get(file);
    assert.equal(image.status, 200);
    assert.match(image.headers.get('cache-control') ?? '', /max-age=86400/);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), new Uint8Array([1, 2, 3]));
    assert.equal((await get(file, image.headers.get('etag') ?? '')).status, 304);
    assert.equal((await get(`${'e'.repeat(64)}.png`)).status, 404);
    assert.equal(imageReads, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
