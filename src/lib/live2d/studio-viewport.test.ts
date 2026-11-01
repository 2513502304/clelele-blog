import assert from 'node:assert/strict';
import test from 'node:test';
import { clampStudioViewport, zoomStudioViewport } from './studio-viewport';

test('viewport bounds agree for gesture and slider input, retaining sub-percent precision', () => {
  assert.deepEqual(clampStudioViewport({ zoom: 900, x: -100, y: 80 }), { zoom: 180, x: -40, y: 40 });
  assert.deepEqual(clampStudioViewport({ zoom: 12, x: 2.34, y: -2.36 }), { zoom: 50, x: 2.3, y: -2.4 });
});

test('zoom preserves the point under the cursor and supports reversal', () => {
  const view = { zoom: 100, x: 10, y: -5 };
  const anchor = { x: 25, y: -20 };
  const zoomed = zoomStudioViewport(view, 150, anchor);
  assert.deepEqual(zoomed, { zoom: 150, x: 2.5, y: 2.5 });
  assert.deepEqual(zoomStudioViewport(zoomed, 100, anchor), view);
  assert.equal((anchor.x - zoomed.x) / zoomed.zoom, (anchor.x - view.x) / view.zoom);
  assert.equal((anchor.y - zoomed.y) / zoomed.zoom, (anchor.y - view.y) / view.zoom);
});

test('zoom at its limit neither moves the model nor amplifies an out-of-bounds gesture', () => {
  const view = { zoom: 180, x: 30, y: -30 };
  assert.deepEqual(zoomStudioViewport(view, 250, { x: -25, y: 25 }), view);
  assert.deepEqual(zoomStudioViewport({ zoom: 50, x: 40, y: -40 }, 180), { zoom: 180, x: 40, y: -40 });
});
