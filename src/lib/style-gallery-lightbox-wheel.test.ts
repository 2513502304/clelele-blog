import assert from 'node:assert/strict';
import test from 'node:test';
import { canConsumeLightboxWheel } from './style-gallery-lightbox-wheel';

test('allows nested lightbox scrolling while content remains in the requested direction', () => {
  const metrics = { scrollTop: 100, scrollHeight: 900, clientHeight: 300 };

  assert.equal(canConsumeLightboxWheel(metrics, -40), true);
  assert.equal(canConsumeLightboxWheel(metrics, 40), true);
});

test('blocks scroll chaining at nested lightbox boundaries', () => {
  assert.equal(canConsumeLightboxWheel({ scrollTop: 0, scrollHeight: 900, clientHeight: 300 }, -40), false);
  assert.equal(canConsumeLightboxWheel({ scrollTop: 600, scrollHeight: 900, clientHeight: 300 }, 40), false);
});

test('does not release the page lock for non-scrollable content or horizontal-only input', () => {
  const metrics = { scrollTop: 0, scrollHeight: 300, clientHeight: 300 };

  assert.equal(canConsumeLightboxWheel(metrics, 40), false);
  assert.equal(canConsumeLightboxWheel({ scrollTop: 100, scrollHeight: 900, clientHeight: 300 }, 0), false);
});
