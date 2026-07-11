import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HpoiCollectionItem } from '@/types/hpoi';
import { createHpoiCollectionUrl } from './constants';
import { sortHpoiCollectionItems } from './sort';

const ITEMS: HpoiCollectionItem[] = [
  {
    id: '20',
    title: 'Beta',
    imageUrl: null,
    detailUrl: 'https://www.hpoi.net/hobby/20',
    releaseText: '出荷：2025年6月2日',
    releaseDate: '2025-06-02',
    score: '4.3',
  },
  {
    id: '3',
    title: 'Alpha',
    imageUrl: null,
    detailUrl: 'https://www.hpoi.net/hobby/3',
    releaseText: '出荷：2024年1月10日',
    releaseDate: '2024-01-10',
    score: '4.8',
  },
  {
    id: '11',
    title: 'Gamma',
    imageUrl: null,
    detailUrl: 'https://www.hpoi.net/hobby/11',
    releaseText: null,
    releaseDate: null,
    score: null,
  },
];

describe('Hpoi collection requests', () => {
  it('uses the metadata-rich compact view for every collection state', () => {
    for (const state of ['all', 'care', 'want', 'preorder', 'buy', 'resell'] as const) {
      assert.equal(new URL(createHpoiCollectionUrl('783694', state)).searchParams.get('view'), '2');
    }
  });
});

describe('sortHpoiCollectionItems', () => {
  it('preserves or reverses the original Hpoi order for the default sort', () => {
    assert.deepEqual(
      sortHpoiCollectionItems(ITEMS, 'default', 'asc').map((item) => item.id),
      ['20', '3', '11'],
    );
    assert.deepEqual(
      sortHpoiCollectionItems(ITEMS, 'default', 'desc').map((item) => item.id),
      ['11', '3', '20'],
    );
    assert.deepEqual(
      ITEMS.map((item) => item.id),
      ['20', '3', '11'],
    );
  });

  it('sorts numeric IDs and names in both directions', () => {
    assert.deepEqual(
      sortHpoiCollectionItems(ITEMS, 'id', 'asc').map((item) => item.id),
      ['3', '11', '20'],
    );
    assert.deepEqual(
      sortHpoiCollectionItems(ITEMS, 'title', 'desc').map((item) => item.title),
      ['Gamma', 'Beta', 'Alpha'],
    );
  });

  it('sorts scores and release dates while keeping missing values last', () => {
    assert.deepEqual(
      sortHpoiCollectionItems(ITEMS, 'score', 'desc').map((item) => item.id),
      ['3', '20', '11'],
    );
    assert.deepEqual(
      sortHpoiCollectionItems(ITEMS, 'releaseDate', 'asc').map((item) => item.id),
      ['3', '20', '11'],
    );
  });
});
