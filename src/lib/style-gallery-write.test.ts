import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StyleGalleryExampleIndex } from '@/types/style-gallery';
import { mergeStyleGalleryExampleIndexRollback } from './style-gallery-write';

function entry(id: string, likedBy: number[] = []) {
  return {
    id,
    src: `/api/style-gallery/image/examples/images/${id}.webp`,
    model: 'GPT-Image2',
    uploadedAt: '2026-07-22T00:00:00.000Z',
    likedBy,
  };
}

describe('style gallery example-index rollback', () => {
  it('restores an attempted structure while retaining concurrent groups and likes', () => {
    const previous: StyleGalleryExampleIndex = {
      version: 2,
      updatedAt: '2026-07-22T00:00:00.000Z',
      groups: [
        { sourceSlug: 'affected', examples: [entry('restored', [1])] },
        { sourceSlug: 'unrelated', examples: [entry('older-unrelated')] },
      ],
    };
    const current: StyleGalleryExampleIndex = {
      version: 2,
      updatedAt: '2026-07-22T00:01:00.000Z',
      groups: [
        { sourceSlug: 'affected', examples: [entry('restored', [1, 2]), entry('failed-write')] },
        { sourceSlug: 'unrelated', examples: [entry('newer-unrelated')] },
        { sourceSlug: 'concurrent', examples: [entry('concurrent-example')] },
      ],
    };
    const attempted = new Map([
      ['affected', { sourceSlug: 'affected', examples: [entry('restored', [1]), entry('failed-write')] }],
    ]);

    assert.deepEqual(mergeStyleGalleryExampleIndexRollback(current, previous, attempted), [
      { sourceSlug: 'affected', examples: [entry('restored', [1, 2])] },
      { sourceSlug: 'unrelated', examples: [entry('newer-unrelated')] },
      { sourceSlug: 'concurrent', examples: [entry('concurrent-example')] },
    ]);
  });

  it('reverts attempted examples while preserving a concurrent addition for the same slug', () => {
    const previous: StyleGalleryExampleIndex = {
      version: 2,
      updatedAt: '',
      groups: [{ sourceSlug: 'affected', examples: [entry('original')] }],
    };
    const current: StyleGalleryExampleIndex = {
      version: 2,
      updatedAt: '',
      groups: [{ sourceSlug: 'affected', examples: [entry('attempted'), entry('concurrent-addition')] }],
    };
    const attempted = new Map([['affected', { sourceSlug: 'affected', examples: [entry('attempted')] }]]);

    assert.deepEqual(mergeStyleGalleryExampleIndexRollback(current, previous, attempted), [
      { sourceSlug: 'affected', examples: [entry('concurrent-addition'), entry('original')] },
    ]);
  });

  it('preserves a concurrent edit to an example changed by the attempted write', () => {
    const previousEntry = { ...entry('shared'), note: 'previous' };
    const attemptedEntry = { ...entry('shared'), note: 'attempted' };
    const concurrentEntry = { ...entry('shared'), note: 'concurrent' };
    const previous: StyleGalleryExampleIndex = {
      version: 2,
      updatedAt: '',
      groups: [{ sourceSlug: 'affected', examples: [previousEntry] }],
    };
    const current: StyleGalleryExampleIndex = {
      version: 2,
      updatedAt: '',
      groups: [{ sourceSlug: 'affected', examples: [concurrentEntry] }],
    };
    const attempted = new Map([['affected', { sourceSlug: 'affected', examples: [attemptedEntry] }]]);

    assert.deepEqual(mergeStyleGalleryExampleIndexRollback(current, previous, attempted), current.groups);
  });

  it('removes a newly-created group only while its attempted structure is still current', () => {
    const previous: StyleGalleryExampleIndex = { version: 2, updatedAt: '', groups: [] };
    const current: StyleGalleryExampleIndex = {
      version: 2,
      updatedAt: '',
      groups: [{ sourceSlug: 'new-item', examples: [entry('new-example')] }],
    };
    const attempted = new Map([['new-item', { sourceSlug: 'new-item', examples: [entry('new-example')] }]]);

    assert.deepEqual(mergeStyleGalleryExampleIndexRollback(current, previous, attempted), []);
  });

  it('restores a removed group unless another request has already recreated it', () => {
    const previous: StyleGalleryExampleIndex = {
      version: 2,
      updatedAt: '',
      groups: [{ sourceSlug: 'removed', examples: [entry('original')] }],
    };
    const current: StyleGalleryExampleIndex = { version: 2, updatedAt: '', groups: [] };

    assert.deepEqual(mergeStyleGalleryExampleIndexRollback(current, previous, new Map([['removed', null]])), previous.groups);

    const concurrent = {
      ...current,
      groups: [{ sourceSlug: 'removed', examples: [entry('concurrent-recreation')] }],
    };
    assert.deepEqual(
      mergeStyleGalleryExampleIndexRollback(concurrent, previous, new Map([['removed', null]])),
      concurrent.groups,
    );
  });
});
