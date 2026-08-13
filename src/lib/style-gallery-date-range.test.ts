import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createStyleGalleryDateRangeMatcher,
  getStyleGalleryDateKey,
  getStyleGalleryRollingDateRange,
  getStyleGalleryTodayRange,
  isStyleGalleryDateKey,
  isStyleGalleryDateTimeValue,
  matchesStyleGalleryDateRange,
  normalizeStyleGalleryDateRange,
  updateStyleGalleryDateRangeFromDay,
} from './style-gallery-date-range';

describe('style gallery date ranges', () => {
  test('uses Shanghai calendar dates at UTC day boundaries', () => {
    assert.equal(getStyleGalleryDateKey('2026-08-12T16:30:00.000Z'), '2026-08-13');
    assert.equal(getStyleGalleryDateKey('2026-08-12T15:59:59.999Z'), '2026-08-12');
  });

  test('validates date and datetime-local boundaries', () => {
    assert.equal(isStyleGalleryDateKey('2026-02-29'), false);
    assert.equal(isStyleGalleryDateKey('2028-02-29'), true);
    assert.equal(isStyleGalleryDateTimeValue('2026-08-13T03:33'), true);
    assert.equal(isStyleGalleryDateTimeValue('2026-02-29T03:33'), false);
    assert.deepEqual(normalizeStyleGalleryDateRange({ from: '2026-08-13T03:33', to: '2026-08-01T04:00' }), {
      from: '2026-08-01T04:00',
      to: '2026-08-13T03:33',
    });
  });

  test('matches exact rolling instants and legacy inclusive date boundaries', () => {
    const timestamp = '2026-08-12T16:30:00.000Z';
    assert.equal(matchesStyleGalleryDateRange(timestamp, { from: '2026-08-13', to: '2026-08-13' }), true);
    assert.equal(matchesStyleGalleryDateRange(timestamp, { from: '', to: '2026-08-12' }), false);
    assert.equal(matchesStyleGalleryDateRange(timestamp, { from: '2026-08-13T00:31', to: '' }), false);
    assert.equal(matchesStyleGalleryDateRange(timestamp, { from: '2026-08-13T00:30', to: '' }), true);
    assert.equal(matchesStyleGalleryDateRange('2026-08-12T16:30:59.999Z', { from: '', to: '2026-08-13T00:30' }), true);
    assert.equal(matchesStyleGalleryDateRange('2026-08-12T16:31:00.000Z', { from: '', to: '2026-08-13T00:30' }), false);
  });

  test('compiles reusable bounds without accepting invalid item timestamps', () => {
    const matches = createStyleGalleryDateRangeMatcher({ from: '2026-08-13T00:00', to: '2026-08-13T23:59' });
    assert.equal(matches('2026-08-13T15:59:59.999Z'), true);
    assert.equal(matches('2026-08-13T16:00:00.000Z'), false);
    assert.equal(matches('not-a-date'), false);
  });

  test('distinguishes today from the rolling last 24 hours', () => {
    const now = new Date('2026-08-13T01:33:00.000Z');
    assert.deepEqual(getStyleGalleryTodayRange(now), { from: '2026-08-13T00:00', to: '2026-08-13T09:33' });
    assert.deepEqual(getStyleGalleryRollingDateRange(1, now), {
      from: '2026-08-12T09:33',
      to: '2026-08-13T09:33',
    });
    assert.equal(matchesStyleGalleryDateRange('2026-08-13T01:33:59.999Z', getStyleGalleryTodayRange(now)), true);
  });

  test('extends an existing range instead of starting a new two-click cycle', () => {
    assert.deepEqual(
      updateStyleGalleryDateRangeFromDay({ from: '2026-08-10T03:00', to: '2026-08-20T04:00' }, '2026-08-27', 'from'),
      { range: { from: '2026-08-10T03:00', to: '2026-08-27T23:59' }, activeBoundary: 'to' },
    );
    assert.deepEqual(
      updateStyleGalleryDateRangeFromDay({ from: '2026-08-10T03:00', to: '2026-08-20T04:00' }, '2026-08-03', 'to'),
      { range: { from: '2026-08-03T00:00', to: '2026-08-20T04:00' }, activeBoundary: 'from' },
    );
  });

  test('uses the active boundary to resolve clicks inside a selected range', () => {
    assert.deepEqual(
      updateStyleGalleryDateRangeFromDay({ from: '2026-08-10T03:00', to: '2026-08-20T04:00' }, '2026-08-15', 'from'),
      { range: { from: '2026-08-15T00:00', to: '2026-08-20T04:00' }, activeBoundary: 'from' },
    );
    assert.deepEqual(
      updateStyleGalleryDateRangeFromDay({ from: '2026-08-10T03:00', to: '2026-08-20T04:00' }, '2026-08-15', 'to'),
      { range: { from: '2026-08-10T03:00', to: '2026-08-15T23:59' }, activeBoundary: 'to' },
    );
  });

  test('uses the second click to place the earlier and later boundaries', () => {
    const first = updateStyleGalleryDateRangeFromDay({ from: '', to: '' }, '2026-08-15', 'from');
    assert.deepEqual(first, {
      range: { from: '2026-08-15T00:00', to: '2026-08-15T23:59' },
      activeBoundary: 'to',
    });
    assert.deepEqual(updateStyleGalleryDateRangeFromDay(first.range, '2026-08-10', first.activeBoundary), {
      range: { from: '2026-08-10T00:00', to: '2026-08-15T23:59' },
      activeBoundary: 'from',
    });
  });
});
