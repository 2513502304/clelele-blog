import assert from 'node:assert/strict';
import test from 'node:test';
import { overviewPage } from './style-gallery-overview-pages';
import { packOverview, unpackOverview } from './style-gallery-overview-payload';

test('a source page includes noncontiguous stack members and the full directory, and global queries can reach the tail', () => {
  const rows = Array.from({ length: 59 }, (_, i) => ({
    id: `image-${i}`,
    sourceSlug: `source-${i % 30}`,
    sourceTitle: `Card ${i % 30}`,
    sourceImage: '/cover',
    sourcePromptCount: 1,
    sourcePromptRevision: 'a',
    sourceExampleCount: 2,
    src: `/image/${i}`,
    model: 'GPT-Image' as const,
    likeCount: i,
    uploadedAt: '2026-11-01T00:00:00Z',
  }));
  const all = packOverview(rows);
  const first = overviewPage(all, 0);
  assert.equal(first.total, 59);
  assert.equal(first.next, 24);
  assert.equal(first.slugs.length, 30);
  assert.deepEqual(
    unpackOverview(first.payload)
      .filter((row) => row.sourceSlug === 'source-0')
      .map((row) => row.id),
    ['image-0', 'image-30'],
  );
  const next = overviewPage(all, first.next!, first.revision);
  assert.equal(next.next, null);
  assert.deepEqual(
    new Set([...unpackOverview(first.payload), ...unpackOverview(next.payload)].map((r) => r.id)),
    new Set(rows.map((r) => r.id)),
  );
  assert.equal(overviewPage(all, 'all').payload, all);
  assert.equal(overviewPage(all, 24, 'obsolete-revision').payload, all);
});
