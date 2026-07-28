import assert from 'node:assert/strict';
import test from 'node:test';
import { createHfS3Client, createHfS3PresignedUrl, createHfS3SignedHeaders, type HfS3Config, HfS3RequestError } from './hf-s3';

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
