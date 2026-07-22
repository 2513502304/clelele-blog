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
  it('restores only affected groups while retaining concurrent groups and likes', () => {
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

    assert.deepEqual(mergeStyleGalleryExampleIndexRollback(current, previous, new Set(['affected'])), [
      { sourceSlug: 'affected', examples: [entry('restored', [1, 2])] },
      { sourceSlug: 'unrelated', examples: [entry('newer-unrelated')] },
      { sourceSlug: 'concurrent', examples: [entry('concurrent-example')] },
    ]);
  });

  it('removes a newly-created affected group when no previous snapshot exists', () => {
    const previous: StyleGalleryExampleIndex = { version: 2, updatedAt: '', groups: [] };
    const current: StyleGalleryExampleIndex = {
      version: 2,
      updatedAt: '',
      groups: [{ sourceSlug: 'new-item', examples: [entry('new-example')] }],
    };

    assert.deepEqual(mergeStyleGalleryExampleIndexRollback(current, previous, new Set(['new-item'])), []);
  });
});
