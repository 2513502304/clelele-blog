import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getStyleGalleryItemCacheTag,
  STYLE_GALLERY_LIST_CACHE_TAG,
  STYLE_GALLERY_PUBLIC_CACHE_CONTROL,
  STYLE_GALLERY_VERCEL_CACHE_CONTROL,
  setStyleGalleryPublicCacheHeaders,
} from './style-gallery-public-cache';

describe('style gallery public CDN cache', () => {
  it('keeps browser revalidation separate from the long Vercel edge lifetime', () => {
    const headers = new Headers();
    setStyleGalleryPublicCacheHeaders(headers, [STYLE_GALLERY_LIST_CACHE_TAG, STYLE_GALLERY_LIST_CACHE_TAG]);

    assert.equal(headers.get('cache-control'), STYLE_GALLERY_PUBLIC_CACHE_CONTROL);
    assert.equal(headers.get('vercel-cdn-cache-control'), STYLE_GALLERY_VERCEL_CACHE_CONTROL);
    assert.equal(headers.get('vercel-cache-tag'), STYLE_GALLERY_LIST_CACHE_TAG);
  });

  it('uses stable per-item tags for targeted detail invalidation', () => {
    assert.equal(getStyleGalleryItemCacheTag('2026-08-26-a1b2c3'), 'style-gallery-item-2026-08-26-a1b2c3');
  });
});
