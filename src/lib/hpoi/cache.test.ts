import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HpoiCollectionResponse } from '@/types/hpoi';
import { refreshHpoiCollectionCache } from './cache';

const snapshot = { fetchedAt: '2026-08-05T12:00:00.000Z' } as HpoiCollectionResponse;

describe('refreshHpoiCollectionCache', () => {
  it('deletes the CDN snapshot only after a fresh Hpoi response succeeds', async () => {
    const operations: string[] = [];
    const result = await refreshHpoiCollectionCache('783694', {
      fetchCollection: async () => {
        operations.push('fetch');
        return snapshot;
      },
      deleteCache: async () => {
        operations.push('delete');
      },
    });

    assert.equal(result, snapshot);
    assert.deepEqual(operations, ['fetch', 'delete']);
  });

  it('preserves the existing CDN snapshot when the upstream fetch fails', async () => {
    let deleted = false;
    await assert.rejects(
      refreshHpoiCollectionCache('783694', {
        fetchCollection: async () => {
          throw new Error('Hpoi unavailable');
        },
        deleteCache: async () => {
          deleted = true;
        },
      }),
      /Hpoi unavailable/,
    );
    assert.equal(deleted, false);
  });
});
