import assert from 'node:assert/strict';
import test from 'node:test';
import { upsertStyleGalleryVisualRecords } from './style-gallery-visual-index';
import { reconcileVisualGroups } from './style-gallery-visual-repair';
import {
  STYLE_GALLERY_VISUAL_MODEL_ID,
  type StyleGalleryVisualFeature,
  type StyleGalleryVisualIndex,
} from './style-gallery-visual-types';

test('a repair retries only missing features, keeps other sources, and can replay safely after deletion or lost acknowledgement', async () => {
  const hashA = 'a'.repeat(64),
    hashB = 'b'.repeat(64);
  const feature = (imageHash: string): StyleGalleryVisualFeature => ({
    imageHash,
    embedding: 'test',
    palette: 'palette',
    perceptualHash: '0',
    differenceHash: '1',
  });
  const empty: StyleGalleryVisualIndex = {
    version: 1,
    updatedAt: new Date().toISOString(),
    model: { id: STYLE_GALLERY_VISUAL_MODEL_ID, dimensions: 384, quantization: 'int8-unit' },
    features: [],
    records: [],
  };
  const initial = upsertStyleGalleryVisualRecords(empty, [
    { kind: 'source', sourceSlug: 'a', imageId: 'cover', feature: feature(hashA) },
    { kind: 'example', sourceSlug: 'a', imageId: 'deleted', feature: feature(hashA) },
    { kind: 'example', sourceSlug: 'b', imageId: 'stay', feature: feature(hashA) },
  ]);
  const groups = [
    {
      sourceSlug: 'a',
      examples: [hashA, hashB].map((hash, i) => ({
        id: 'result-' + i,
        src: '/api/style-gallery/image/examples/images/' + hash + '.png',
        model: 'GPT-Image' as const,
        uploadedAt: '',
        likedBy: [],
      })),
    },
  ];
  const touched = new Set(['a']);
  const first = await reconcileVisualGroups(initial, groups, touched, () => Promise.reject(Error('offline')));
  assert.equal(first.remaining, 1);
  assert.deepEqual(
    first.index.records.map((r) => r.imageId),
    ['cover', 'stay', 'result-0'],
  );
  const repaired = await reconcileVisualGroups(first.index, groups, touched, async (_, hash) => {
    assert.equal(hash, hashB);
    return feature(hash);
  });
  assert.equal(repaired.remaining, 0);
  assert.equal((await reconcileVisualGroups(repaired.index, groups, touched, () => assert.fail())).index, repaired.index);
  const deleted = await reconcileVisualGroups(repaired.index, [], touched, () => assert.fail());
  assert.deepEqual(
    deleted.index.records.map((r) => r.imageId),
    ['cover', 'stay'],
  );
});
