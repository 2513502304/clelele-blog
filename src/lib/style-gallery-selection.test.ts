import assert from 'node:assert/strict';
import { it } from 'node:test';
import { combineGallerySelection, intersectsSelection } from './style-gallery-selection';

it('replaces a selection unless a modifier appends, deduplicating source groups and enforcing pair limits', () => {
  assert.deepEqual([...combineGallerySelection(['hidden'], ['a', 'a', 'b'], false)], ['a', 'b']);
  assert.deepEqual([...combineGallerySelection(['hidden'], ['a', 'b'], true, 2)], ['hidden', 'a']);
  assert.deepEqual([...combineGallerySelection(['a'], [], false)], []);
  assert.deepEqual([...combineGallerySelection(['a'], [], true)], ['a']);
});

it('requires positive overlap instead of selecting cards that only touch a rectangle edge', () => {
  const card = { left: 10, top: 100, right: 110, bottom: 250 };
  assert.equal(intersectsSelection(card, { left: 0, top: 80, right: 10, bottom: 260 }), false);
  assert.equal(intersectsSelection(card, { left: 0, top: 80, right: 11, bottom: 101 }), true);
  assert.equal(intersectsSelection(card, { left: 50, top: 250, right: 80, bottom: 260 }), false);
});
