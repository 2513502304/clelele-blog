import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { createNativeAssetFetch } from './native-asset-fetch';

const bytes = new TextEncoder().encode('original model asset');
const hash = createHash('sha256').update(bytes).digest('hex');
const url = (release: string) => `https://blog.test/api/live2d-assets/releases/${release.repeat(64)}/assets/${hash}.glsl`;
function memoryCache() {
  const entries = new Map<string, Response>();
  return {
    match: async (key: string | Request) => entries.get(typeof key === 'string' ? key : key.url)?.clone(),
    put: async (key: string, value: Response) => {
      entries.set(key, value.clone());
    },
    delete: async (key: string | Request) => entries.delete(typeof key === 'string' ? key : key.url),
    keys: async () => [...entries.keys()].map((key) => new Request(key)),
  };
}

test('retries a transient 502 and reuses identical assets across costume releases', async () => {
  let requests = 0;
  const cached = createNativeAssetFetch({
    fetch: async () => (++requests === 1 ? new Response('upstream failed', { status: 502 }) : new Response(bytes)),
    openCache: async () => memory,
    wait: async () => {},
  });
  const memory = memoryCache();
  assert.deepEqual(new Uint8Array(await (await cached(url('a'))).arrayBuffer()), bytes);
  assert.deepEqual(new Uint8Array(await (await cached(url('b'))).arrayBuffer()), bytes);
  assert.equal(requests, 2);
});

test('retries body transport failures and never stores partial or hash-mismatched bytes', async () => {
  let requests = 0;
  const cache = memoryCache();
  const cached = createNativeAssetFetch({
    fetch: async () => {
      requests++;
      if (requests === 1)
        return new Response(
          new ReadableStream({
            start(c) {
              c.error(new TypeError('connection reset'));
            },
          }),
        );
      return new Response(requests === 2 ? 'corrupt' : bytes);
    },
    openCache: async () => cache,
    wait: async () => {},
  });
  await assert.rejects(cached(url('a')), /integrity/i);
  assert.equal((await cache.keys()).length, 0);
  assert.deepEqual(new Uint8Array(await (await cached(url('a'))).arrayBuffer()), bytes);
});

test('gzip filenames hash decoded content; validate stored bytes with the asset route ETag', async () => {
  const compressed = new Uint8Array(gzipSync(bytes));
  const compressedHash = createHash('sha256').update(compressed).digest('hex');
  const cache = memoryCache();
  let requests = 0;
  const cached = createNativeAssetFetch({
    fetch: async () => {
      requests++;
      return new Response(compressed, { headers: { ETag: `"sha256-${compressedHash}"` } });
    },
    openCache: async () => cache,
  });
  assert.deepEqual(new Uint8Array(await (await cached(`${url('a')}.gz`)).arrayBuffer()), compressed);
  await cached(`${url('a')}.gz`);
  assert.equal(requests, 1);
  // Different exports may compress the same content differently; keep their stored sizes separate.
  await cached(`${url('b')}.gz`);
  assert.equal(requests, 2);
  const noValidator = createNativeAssetFetch({
    fetch: async () => new Response(compressed),
    openCache: async () => cache,
  });
  const uncachedUrl = `${url('a').replace('.glsl', '.json')}.gz`;
  assert.equal((await noValidator(uncachedUrl)).status, 200);
  assert.equal((await cache.keys()).length, 2);
});

test('permanent HTTP errors and cancellation do not retry; unavailable cache remains optional', async () => {
  let requests = 0;
  const cached = createNativeAssetFetch({
    fetch: async () => {
      requests++;
      return new Response('', { status: 404 });
    },
    openCache: async () => {
      throw new Error('storage denied');
    },
    wait: async () => {},
  });
  assert.equal((await cached(url('a'))).status, 404);
  assert.equal(requests, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(cached(url('a'), { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(requests, 1);
});

test('bounds persistent cache bytes and does not keep manifests under shared hash keys', async () => {
  const memory = memoryCache();
  const other = new TextEncoder().encode('second asset');
  const otherHash = createHash('sha256').update(other).digest('hex');
  const cached = createNativeAssetFetch({
    fetch: async (input) => new Response(String(input).includes(otherHash) ? other : bytes),
    openCache: async () => memory,
    maxBytes: bytes.length,
  });
  await cached(url('a'));
  await cached(url('b').replace(hash, otherHash));
  assert.equal((await memory.keys()).length, 1);
  assert.ok((await memory.keys())[0].url.includes(otherHash));
  await cached('https://blog.test/api/live2d-assets/releases/a/model.native.json');
  assert.equal((await memory.keys()).length, 1);
});
