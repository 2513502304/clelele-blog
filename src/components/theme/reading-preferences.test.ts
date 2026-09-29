import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_READING, normalizeReadingPreferences } from './reading-preferences';

test('invalid persisted settings cannot introduce invalid CSS values or unknown choices', () => {
  assert.deepEqual(normalizeReadingPreferences(null), DEFAULT_READING);
  assert.deepEqual(normalizeReadingPreferences({ fontSize: 'large', lineHeight: Infinity, font: 'unknown' }), DEFAULT_READING);
  assert.deepEqual(normalizeReadingPreferences({ fontSize: NaN, density: '__proto__', motion: {} }), DEFAULT_READING);
});

test('reading scale and line height clamp and round independently', () => {
  const result = normalizeReadingPreferences({ fontSize: 999, lineHeight: -10, font: 'serif', density: 'compact' });
  assert.equal(result.fontSize, 130);
  assert.equal(result.lineHeight, 1.4);
  assert.equal(result.font, 'serif');
  assert.equal(result.density, 'compact');
  assert.equal(normalizeReadingPreferences({ lineHeight: 1.86 }).lineHeight, 1.9);
  assert.equal(normalizeReadingPreferences({ fontSize: 101.4 }).fontSize, 101);
});
