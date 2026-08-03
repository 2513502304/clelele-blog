import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getStyleGallerySignedImageRedirectCacheSeconds } from './hf-s3-presign';

describe('style gallery signed image redirect cache', () => {
  it('expires the CDN entry before a normal signed URL', () => {
    assert.equal(getStyleGallerySignedImageRedirectCacheSeconds(86_400), 86_100);
  });

  it('keeps a proportional safety window for short custom TTL values', () => {
    assert.equal(getStyleGallerySignedImageRedirectCacheSeconds(60), 30);
    assert.equal(getStyleGallerySignedImageRedirectCacheSeconds(10), 5);
    assert.equal(getStyleGallerySignedImageRedirectCacheSeconds(2), 0);
  });
});
