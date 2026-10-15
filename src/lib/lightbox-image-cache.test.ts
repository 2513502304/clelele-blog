import assert from 'node:assert/strict';
import test from 'node:test';
import { cacheLightboxImage, discardCachedLightboxImage, getCachedLightboxImage } from './lightbox-image-cache';

test('viewed responses use exact URL identities and an LRU entry limit', () => {
  for (let i = 0; i < 6; i++) cacheLightboxImage(`/recent-${i}`, new Blob([String(i)]));
  assert.ok(getCachedLightboxImage('/recent-0'));
  cacheLightboxImage('/recent-6', new Blob(['6']));
  assert.equal(getCachedLightboxImage('/recent-1'), undefined);
  assert.ok(getCachedLightboxImage('/recent-0'));
  assert.equal(getCachedLightboxImage('/recent-0?signature=new'), undefined);
  discardCachedLightboxImage('/recent-0');
  assert.equal(getCachedLightboxImage('/recent-0'), undefined);
});

test('byte limits bound large originals and oversized responses are not retained', () => {
  const large = new Blob([new Uint8Array(17 * 1024 * 1024)]);
  cacheLightboxImage('/large-1', large);
  cacheLightboxImage('/large-2', large);
  assert.equal(getCachedLightboxImage('/large-1'), undefined);
  assert.equal(getCachedLightboxImage('/large-2'), large);
  cacheLightboxImage('/large-2', new Blob([large, large]));
  assert.equal(getCachedLightboxImage('/large-2'), undefined);
});
