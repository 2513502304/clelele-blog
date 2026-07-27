import assert from 'node:assert/strict';
import test from 'node:test';
import { createHfS3PresignedUrl, createHfS3SignedHeaders, type HfS3Config } from './hf-s3';

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
  assert.match(url, /^https:\/\/s3\.hf\.co\/clelele0722\/raw-datasets\/image-style-prompt-gallery\/source\//);
  assert.match(url, /X-Amz-Credential=HFAKTEST%2F20260727%2Fus-east-1%2Fs3%2Faws4_request/);
  assert.match(url, /X-Amz-Signature=[a-f0-9]{64}$/);
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
