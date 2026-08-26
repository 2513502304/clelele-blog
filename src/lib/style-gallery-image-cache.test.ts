import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getStyleGallerySignedImageRedirectCacheSeconds } from './hf-s3-presign';

describe('style gallery signed image redirect cache', () => {
  it('defaults immutable gallery images to the SigV4 seven-day maximum', () => {
    const previous = process.env.STYLE_GALLERY_SIGNED_URL_TTL_SECONDS;
    delete process.env.STYLE_GALLERY_SIGNED_URL_TTL_SECONDS;
    try {
      assert.equal(getStyleGallerySignedImageRedirectCacheSeconds(), 604_500);
    } finally {
      if (previous === undefined) delete process.env.STYLE_GALLERY_SIGNED_URL_TTL_SECONDS;
      else process.env.STYLE_GALLERY_SIGNED_URL_TTL_SECONDS = previous;
    }
  });

  it('expires the CDN entry before a normal signed URL', () => {
    assert.equal(getStyleGallerySignedImageRedirectCacheSeconds(86_400), 86_100);
  });

  it('keeps a proportional safety window for short custom TTL values', () => {
    assert.equal(getStyleGallerySignedImageRedirectCacheSeconds(60), 30);
    assert.equal(getStyleGallerySignedImageRedirectCacheSeconds(10), 5);
    assert.equal(getStyleGallerySignedImageRedirectCacheSeconds(2), 0);
  });
});
