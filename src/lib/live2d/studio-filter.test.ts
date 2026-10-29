import assert from 'node:assert/strict';
import test from 'node:test';
import { studioFilterCss } from './studio-state';

test('color strength interpolates from neutral and is bounded for preview/export', () => {
  assert.equal(studioFilterCss('film', 0), 'none');
  assert.equal(studioFilterCss('film', -1), 'none');
  assert.equal(studioFilterCss('original', 100), 'none');
  assert.equal(studioFilterCss('film', 50), 'sepia(0.125) saturate(0.925) contrast(1.04)');
  assert.equal(studioFilterCss('film', 500), studioFilterCss('film', 100));
  assert.equal(studioFilterCss('film', NaN), studioFilterCss('film', 100));
  assert.match(studioFilterCss('rose', 50), /hue-rotate\(-22.5deg\)/);
});
