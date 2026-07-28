import assert from 'node:assert/strict';
import test from 'node:test';
import { createLive2DAssetRouteHandler } from './asset-route';
import { type Live2DAssetOriginReader, Live2DReadCredentialsError, resolveLive2DPackageAsset } from './assets';

const releaseId = '9e95d66201f07e339bd5542b1dd0d67ae1bd0b0f9b14a7335ca0bad6bd5916ad';
const relativePath = 'data/expressions/default.exp.json';
const key = `releases/${releaseId}/${relativePath}`;
const asset = resolveLive2DPackageAsset(releaseId, relativePath);

function createReader(): Live2DAssetOriginReader & { reads: number } {
  return {
    reads: 0,
    inFlightCount: 0,
    async read() {
      this.reads += 1;
      return new Response(new Uint8Array(asset.size));
    },
    async verify() {
      this.reads += 1;
    },
  };
}

test('HEAD verifies origin availability and returns immutable manifest metadata', async () => {
  const reader = createReader();
  const response = await createLive2DAssetRouteHandler(reader)(
    new Request(`https://blog.example/api/live2d-assets/${key}`, { method: 'HEAD' }),
    key,
  );
  assert.equal(response.status, 200);
  assert.equal(reader.reads, 1);
  assert.equal(response.headers.get('content-type'), asset.mime);
  assert.equal(response.headers.get('content-length'), String(asset.size));
  assert.equal(response.headers.get('etag'), `"sha256-${asset.sha256}"`);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(response.headers.get('vercel-cdn-cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(await response.text(), '');
});

test('delivery kill switch returns 404 before resolving a manifest member', async () => {
  const reader = createReader();
  const response = await createLive2DAssetRouteHandler(reader, () => false)(
    new Request(`https://blog.example/api/live2d-assets/${key}`),
    key,
  );
  assert.equal(response.status, 404);
  assert.equal(reader.reads, 0);
});

test('missing read credentials are classified as service unavailable', async () => {
  const reader: Live2DAssetOriginReader = {
    inFlightCount: 0,
    async read() {
      throw new Live2DReadCredentialsError();
    },
    async verify() {
      throw new Live2DReadCredentialsError();
    },
  };
  const handle = createLive2DAssetRouteHandler(reader);
  for (const method of ['GET', 'HEAD']) {
    const response = await handle(new Request(`https://blog.example/api/live2d-assets/${key}`, { method }), key);
    assert.equal(response.status, 503);
  }
});

test('GET streams the allowlisted object with authoritative headers', async () => {
  const reader = createReader();
  const response = await createLive2DAssetRouteHandler(reader)(
    new Request(`https://blog.example/api/live2d-assets/${key}`),
    key,
  );
  assert.equal(response.status, 200);
  assert.equal(reader.reads, 1);
  assert.equal((await response.arrayBuffer()).byteLength, asset.size);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
});

test('streams valid browser media ranges with partial-content metadata', async () => {
  const bytes = Uint8Array.from({ length: asset.size }, (_, index) => index % 251);
  const reader: Live2DAssetOriginReader & { reads: number } = {
    reads: 0,
    inFlightCount: 0,
    async read() {
      this.reads += 1;
      return new Response(bytes);
    },
    async verify() {
      this.reads += 1;
    },
  };
  const response = await createLive2DAssetRouteHandler(reader)(
    new Request(`https://blog.example/api/live2d-assets/${key}`, { headers: { range: 'bytes=2-5' } }),
    key,
  );

  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), `bytes 2-5/${asset.size}`);
  assert.equal(response.headers.get('content-length'), '4');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes.subarray(2, 6));
  assert.equal(reader.reads, 1);
});

test('supports the open-ended range Chromium uses for character audio', async () => {
  const reader = createReader();
  const response = await createLive2DAssetRouteHandler(reader)(
    new Request(`https://blog.example/api/live2d-assets/${key}`, { headers: { range: 'bytes=0-' } }),
    key,
  );

  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), `bytes 0-${asset.size - 1}/${asset.size}`);
  assert.equal((await response.arrayBuffer()).byteLength, asset.size);
});

test('rejects non-read methods, query variants and authorization before origin access', async () => {
  const reader = createReader();
  const handle = createLive2DAssetRouteHandler(reader);
  const requests = [
    new Request(`https://blog.example/api/live2d-assets/${key}`, { method: 'POST' }),
    new Request(`https://blog.example/api/live2d-assets/${key}?download=1`),
    new Request(`https://blog.example/api/live2d-assets/${key}`, { headers: { authorization: 'Bearer secret' } }),
  ];
  for (const request of requests) {
    const response = await handle(request, key);
    assert.ok(response.status === 400 || response.status === 405);
  }
  assert.equal(reader.reads, 0);
});

test('rejects invalid and multi-range requests before origin access', async () => {
  const reader = createReader();
  const handle = createLive2DAssetRouteHandler(reader);
  for (const range of [`bytes=${asset.size}-`, 'bytes=0-1,4-5', 'items=0-1']) {
    const response = await handle(new Request(`https://blog.example/api/live2d-assets/${key}`, { headers: { range } }), key);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), `bytes */${asset.size}`);
  }
  assert.equal(reader.reads, 0);
});

test('encoded traversal, duplicate separators, unknown releases and absent members never read origin', async () => {
  const reader = createReader();
  const handle = createLive2DAssetRouteHandler(reader);
  const invalidKeys = [
    `releases/${releaseId}/%2e%2e/model.json`,
    `releases/${releaseId}//model.json`,
    `releases/${releaseId}/data\\model.moc`,
    `releases/${'a'.repeat(64)}/model.json`,
    `releases/${releaseId}/missing.bin`,
  ];
  for (const invalidKey of invalidKeys) {
    const response = await handle(new Request('https://blog.example/api/live2d-assets/invalid'), invalidKey);
    assert.ok(response.status === 400 || response.status === 404);
  }
  assert.equal(reader.reads, 0);
});
