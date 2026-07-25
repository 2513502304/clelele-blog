import assert from 'node:assert/strict';
import test from 'node:test';
import { createStyleGallerySignedDownloadUrl } from '@lib/hf-s3-presign';

test('signs Gallery downloads with an attachment response override', () => {
  const previous = {
    accessKey: process.env.HF_S3_ACCESS_KEY_ID,
    secretKey: process.env.HF_S3_SECRET_ACCESS_KEY,
  };
  process.env.HF_S3_ACCESS_KEY_ID = 'HFAKTEST';
  process.env.HF_S3_SECRET_ACCESS_KEY = 'test-secret';

  try {
    const signed = new URL(
      createStyleGallerySignedDownloadUrl(
        'examples/images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp',
        new Date('2026-07-25T00:00:00.000Z'),
      ),
    );
    assert.equal(
      signed.searchParams.get('response-content-disposition'),
      'attachment; filename="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp"',
    );
    assert.match(signed.search, /^\?X-Amz-Algorithm=/);
    assert.match(signed.searchParams.get('X-Amz-Signature') ?? '', /^[a-f0-9]{64}$/);
  } finally {
    if (previous.accessKey === undefined) delete process.env.HF_S3_ACCESS_KEY_ID;
    else process.env.HF_S3_ACCESS_KEY_ID = previous.accessKey;
    if (previous.secretKey === undefined) delete process.env.HF_S3_SECRET_ACCESS_KEY;
    else process.env.HF_S3_SECRET_ACCESS_KEY = previous.secretKey;
  }
});
