import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHfS3Client,
  createHfS3PresignedUrl,
  createHfS3SignedHeaders,
  fetchHfS3Read,
  type HfS3Config,
  HfS3RequestError,
} from './hf-s3';

const config: HfS3Config = {
  accessKeyId: 'HFAKTEST',
  secretAccessKey: 'test-secret',
  endpoint: new URL('https://s3.hf.co/clelele0722'),
  bucket: 'raw-datasets',
  prefix: 'image-style-prompt-gallery',
  region: 'us-east-1',
};

test('presigned URLs preserve the existing HF path and deterministic signature', () => {
  const url = createHfS3PresignedUrl(config, 'GET', 'source/测试 image.png', 86400, new Date('2026-07-27T00:00:00Z'));
  assert.equal(
    url,
    'https://s3.hf.co/clelele0722/raw-datasets/image-style-prompt-gallery/source/%E6%B5%8B%E8%AF%95%20image.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=HFAKTEST%2F20260727%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260727T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=a88e9e095412e8a6c4833c3ab4e5ae6dbd87b5541f5f41b9dff0bbc996e77889',
  );
  assert.equal(
    new URL(url).pathname,
    '/clelele0722/raw-datasets/image-style-prompt-gallery/source/%E6%B5%8B%E8%AF%95%20image.png',
  );
});

test('conditional writes include the condition in the signed header set', () => {
  const signed = createHfS3SignedHeaders(
    config,
    'PUT',
    'metadata/catalog.json',
    new TextEncoder().encode('{}'),
    'application/json',
    { ifNoneMatch: '*' },
    new Date('2026-07-27T00:00:00Z'),
  );
  assert.equal(signed.headers['if-none-match'], '*');
  assert.match(signed.headers.authorization, /SignedHeaders=content-type;host;if-none-match;x-amz-content-sha256;x-amz-date/);
});

test('signing rejects cleartext endpoints before producing credentials', () => {
  const insecure = { ...config, endpoint: new URL('http://s3.hf.co/clelele0722') };
  assert.throws(() => createHfS3PresignedUrl(insecure, 'GET', 'source/image.png', 60), /must use HTTPS/);
  assert.throws(() => createHfS3SignedHeaders(insecure, 'PUT', 'source/image.png', new Uint8Array()), /must use HTTPS/);
});

test('object requests never follow unchecked redirects', async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.redirect, ['PUT', 'DELETE'].includes(init?.method ?? 'GET') ? 'error' : 'manual');
    methods.push(init?.method ?? 'GET');
    return new Response(null, { status: 200 });
  };
  try {
    const client = createHfS3Client(config, { attempts: 1 });
    await client.head('source/image.png');
    await client.get('source/image.png');
    await client.put('source/image.png', new Uint8Array(), 'image/png');
    await client.delete('source/image.png');
    assert.deepEqual(methods, ['HEAD', 'GET', 'PUT', 'DELETE']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('exhausted retries preserve the typed HF S3 request error', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response('temporarily unavailable', { status: 503 });
  };
  try {
    await assert.rejects(
      createHfS3Client(config, { attempts: 2 }).head('metadata/catalog.json'),
      (error: unknown) =>
        error instanceof HfS3RequestError &&
        error.retryable &&
        error.status === 503 &&
        /temporarily unavailable/.test(error.message),
    );
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('read redirects allow HTTPS CDN delivery but block downgrade and credential forwarding', async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (calls === 1) return new Response(null, { status: 302, headers: { location: 'https://cdn.example.test/image' } });
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    assert.equal(new Headers(init?.headers).get('range'), 'bytes=0-99');
    return new Response('pixels');
  };
  try {
    const response = await fetchHfS3Read('https://s3.example.test/image', {
      headers: { authorization: 'test', range: 'bytes=0-99' },
    });
    assert.equal(await response.text(), 'pixels');
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location: 'http://cdn.example.test/image' } });
    };
    await assert.rejects(fetchHfS3Read('https://s3.example.test/image'), /must use HTTPS/);
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location: '/loop' } });
    };
    await assert.rejects(fetchHfS3Read('https://s3.example.test/image'), /excessive/);
    assert.equal(calls, 6);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
