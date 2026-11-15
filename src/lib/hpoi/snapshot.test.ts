import assert from 'node:assert/strict';
import test from 'node:test';
import type { HpoiCollectionItem } from '@/types/hpoi';
import { reconcileHpoiItems } from './snapshot';

const item = (id: string, title = id): HpoiCollectionItem => ({
  id,
  title,
  imageUrl: null,
  detailUrl: `https://www.hpoi.net/hobby/${id}`,
  releaseText: null,
  releaseDate: null,
  score: null,
});

test('complete snapshots reconcile additions, deletions, changed content and order without replacing unchanged objects', () => {
  const a = item('1'),
    b = item('2'),
    removed = item('3');
  const result = reconcileHpoiItems([a, b, removed], [item('2', 'updated'), item('4'), item('1'), item('1')]);
  assert.deepEqual(
    result.map((i) => i.id),
    ['2', '4', '1'],
  );
  assert.equal(result[2], a);
  assert.notEqual(result[0], b);
  assert.equal(result[0].title, 'updated');
  assert.deepEqual(reconcileHpoiItems(result, []), []);
});
