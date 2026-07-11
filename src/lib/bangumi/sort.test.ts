import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BangumiUserCollection } from '@/types/bangumi';
import { sortBangumiCollectionItems } from './sort';

function createItem(
  subjectId: number,
  name: string,
  nameCn: string,
  date: string | null,
  subjectScore: number,
  userRate = 0,
): BangumiUserCollection {
  return {
    subject_id: subjectId,
    subject_type: 2,
    rate: userRate,
    type: 2,
    tags: [],
    ep_status: 0,
    vol_status: 0,
    updated_at: '2026-01-01T00:00:00Z',
    subject: { id: subjectId, type: 2, name, name_cn: nameCn, date, score: subjectScore },
  };
}

const ITEMS = [
  createItem(20, 'Beta', '乙', '2025-06-02', 7.2),
  createItem(3, 'Alpha', '甲', '2024-01-10', 8.1, 9),
  createItem(11, 'Gamma', '', null, 0),
];

describe('sortBangumiCollectionItems', () => {
  it('preserves or reverses the original API order without mutating it', () => {
    assert.deepEqual(
      sortBangumiCollectionItems(ITEMS, 'default', 'asc').map((item) => item.subject_id),
      [20, 3, 11],
    );
    assert.deepEqual(
      sortBangumiCollectionItems(ITEMS, 'default', 'desc').map((item) => item.subject_id),
      [11, 3, 20],
    );
    assert.deepEqual(
      ITEMS.map((item) => item.subject_id),
      [20, 3, 11],
    );
  });

  it('sorts localized titles and release dates in both directions', () => {
    assert.deepEqual(
      sortBangumiCollectionItems(ITEMS, 'title', 'asc').map((item) => item.subject_id),
      [3, 20, 11],
    );
    assert.deepEqual(
      sortBangumiCollectionItems(ITEMS, 'date', 'desc').map((item) => item.subject_id),
      [20, 3, 11],
    );
  });

  it('sorts personal and average scores independently while keeping missing scores last', () => {
    assert.deepEqual(
      sortBangumiCollectionItems(ITEMS, 'personalScore', 'desc').map((item) => item.subject_id),
      [3, 20, 11],
    );
    assert.deepEqual(
      sortBangumiCollectionItems(ITEMS, 'averageScore', 'desc').map((item) => item.subject_id),
      [3, 20, 11],
    );
  });
});
