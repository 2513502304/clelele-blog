import assert from 'node:assert/strict';
import test from 'node:test';
import { getStyleGalleryDefaultSortDirection, STYLE_GALLERY_SORT_KEYS } from './style-gallery-sort';

test('keeps catalog order by default and prioritizes high values for explicit sorts', () => {
  assert.equal(getStyleGalleryDefaultSortDirection('default'), 'asc');
  for (const key of STYLE_GALLERY_SORT_KEYS.filter((candidate) => candidate !== 'default')) {
    assert.equal(getStyleGalleryDefaultSortDirection(key), 'desc');
  }
});
