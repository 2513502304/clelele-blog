import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encodePalette, encodeQuantizedEmbedding } from './style-gallery-visual-feature';
import {
  planStyleGallerySourceVisualRecords,
  removeStyleGalleryVisualRecords,
  replaceStyleGallerySourceVisualRecords,
  searchStyleGalleryVisualIndex,
  upsertStyleGalleryVisualRecords,
} from './style-gallery-visual-index';
import {
  STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION,
  STYLE_GALLERY_VISUAL_INDEX_VERSION,
  STYLE_GALLERY_VISUAL_MODEL_ID,
  type StyleGalleryVisualFeature,
  type StyleGalleryVisualIndex,
  type StyleGalleryVisualRecordInput,
} from './style-gallery-visual-types';

function emptyIndex(): StyleGalleryVisualIndex {
  return {
    version: STYLE_GALLERY_VISUAL_INDEX_VERSION,
    updatedAt: new Date(0).toISOString(),
    model: {
      id: STYLE_GALLERY_VISUAL_MODEL_ID,
      dimensions: STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION,
      quantization: 'int8-unit',
    },
    features: [],
    records: [],
  };
}

function feature(imageHash: string, axis: number, color: [number, number, number]): StyleGalleryVisualFeature {
  const embedding = new Float32Array(STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION);
  embedding[axis] = 1;
  return {
    imageHash,
    perceptualHash: axis === 0 ? '0000000000000000' : 'ffffffffffffffff',
    differenceHash: axis === 0 ? '0000000000000000' : 'ffffffffffffffff',
    palette: encodePalette([
      [...color, 255],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]),
    embedding: encodeQuantizedEmbedding(embedding),
  };
}

function record(
  imageFeature: StyleGalleryVisualFeature,
  sourceSlug: string,
  imageId: string,
  kind: 'source' | 'example' = 'source',
): StyleGalleryVisualRecordInput {
  return { feature: imageFeature, kind, sourceSlug, imageId };
}

describe('style gallery visual index', () => {
  it('deduplicates features, replaces logical records, and removes orphan feature vectors', () => {
    const red = feature('a'.repeat(64), 0, [240, 32, 48]);
    const blue = feature('b'.repeat(64), 1, [32, 64, 240]);
    const inserted = upsertStyleGalleryVisualRecords(emptyIndex(), [
      record(red, 'source-a', red.imageHash),
      record(red, 'source-b', red.imageHash),
      record(blue, 'source-c', blue.imageHash),
    ]);
    assert.equal(inserted.features.length, 2);
    assert.equal(inserted.records.length, 3);

    const replaced = upsertStyleGalleryVisualRecords(inserted, [record(blue, 'source-a', red.imageHash)]);
    assert.equal(replaced.records.find((entry) => entry.sourceSlug === 'source-a')?.featureIndex, 1);

    const compacted = removeStyleGalleryVisualRecords(replaced, (entry) => entry.sourceSlug !== 'source-a');
    assert.equal(compacted.features.length, 1);
    assert.equal(compacted.records.length, 1);
    assert.equal(compacted.records[0].featureIndex, 0);
    assert.equal(compacted.features[0].imageHash, blue.imageHash);
  });

  it('replaces touched source records and removes draft entries without affecting examples', () => {
    const red = feature('a'.repeat(64), 0, [240, 32, 48]);
    const blue = feature('b'.repeat(64), 1, [32, 64, 240]);
    const current = upsertStyleGalleryVisualRecords(emptyIndex(), [
      record(red, 'drafted', red.imageHash),
      record(red, 'drafted', 'example-a', 'example'),
      record(red, 'updated', red.imageHash),
    ]);
    const replaced = replaceStyleGallerySourceVisualRecords(current, new Set(['drafted', 'updated']), [
      record(blue, 'updated', blue.imageHash),
    ]);

    assert.deepEqual(
      replaced.records.map(({ kind, sourceSlug, imageId }) => ({ kind, sourceSlug, imageId })),
      [
        { kind: 'example', sourceSlug: 'drafted', imageId: 'example-a' },
        { kind: 'source', sourceSlug: 'updated', imageId: blue.imageHash },
      ],
    );
  });

  it('plans shared component images by parent item identity instead of component hash', () => {
    const shared = feature('a'.repeat(64), 0, [240, 32, 48]);
    const uniqueB = feature('b'.repeat(64), 1, [32, 64, 240]);
    const uniqueDraft = feature('c'.repeat(64), 1, [64, 240, 32]);
    const submitted = [
      { slug: 'item-a', imageHash: '1'.repeat(64) },
      { slug: 'item-b', imageHash: '2'.repeat(64) },
      { slug: 'item-draft', imageHash: '3'.repeat(64), draft: true },
    ];
    const records = [
      record(shared, 'item-a', shared.imageHash),
      record(shared, 'item-b', shared.imageHash),
      record(uniqueB, 'item-b', uniqueB.imageHash),
      record(shared, 'item-draft', shared.imageHash),
      record(uniqueDraft, 'item-draft', uniqueDraft.imageHash),
    ];
    const plan = planStyleGallerySourceVisualRecords(
      submitted,
      submitted.map((item) => ({ ...item, slug: `${item.slug}-canonical` })),
      records,
    );

    assert.deepEqual(
      plan.activeRecords.map((entry) => `${entry.sourceSlug}:${entry.imageId}`),
      [`item-a-canonical:${shared.imageHash}`, `item-b-canonical:${shared.imageHash}`, `item-b-canonical:${uniqueB.imageHash}`],
    );
    assert.ok(plan.touchedSlugs.has('item-draft'));
    assert.ok(plan.touchedSlugs.has('item-draft-canonical'));
  });

  it('ranks exact, semantic, near-duplicate, and palette matches without crossing scopes', () => {
    const red = feature('a'.repeat(64), 0, [240, 32, 48]);
    const blue = feature('b'.repeat(64), 1, [32, 64, 240]);
    const index = upsertStyleGalleryVisualRecords(emptyIndex(), [
      record(red, 'source-a', red.imageHash),
      record(red, 'source-a', 'example-a', 'example'),
      record(blue, 'source-b', blue.imageHash),
    ]);

    assert.deepEqual(searchStyleGalleryVisualIndex(index, { mode: 'combined', scope: 'source', feature: red })[0], {
      kind: 'source',
      sourceSlug: 'source-a',
      imageId: red.imageHash,
      score: 1,
    });
    assert.equal(searchStyleGalleryVisualIndex(index, { mode: 'semantic', scope: 'source', feature: red }).length, 1);
    assert.equal(searchStyleGalleryVisualIndex(index, { mode: 'near-duplicate', scope: 'source', feature: blue }).length, 1);
    assert.equal(
      searchStyleGalleryVisualIndex(index, { mode: 'palette', scope: 'source', color: '#ef2030', range: 50 })[0].sourceSlug,
      'source-a',
    );
    assert.equal(
      searchStyleGalleryVisualIndex(index, { mode: 'combined', scope: 'example', feature: red })[0].imageId,
      'example-a',
    );
  });

  it('does not silently truncate broad filters at the former 500-result boundary', () => {
    const red = feature('a'.repeat(64), 0, [240, 32, 48]);
    const index = upsertStyleGalleryVisualRecords(
      emptyIndex(),
      Array.from({ length: 600 }, (_, index) => record(red, `source-${index}`, `image-${index}`)),
    );
    assert.equal(
      searchStyleGalleryVisualIndex(index, {
        mode: 'palette',
        scope: 'source',
        color: '#ef2030',
        range: 100,
      }).length,
      600,
    );
  });

  it('uses a continuous match range while preserving the calibrated default', () => {
    const red = feature('a'.repeat(64), 0, [240, 32, 48]);
    const nearbyRed = feature('b'.repeat(64), 1, [210, 70, 75]);
    const index = upsertStyleGalleryVisualRecords(emptyIndex(), [record(nearbyRed, 'nearby', nearbyRed.imageHash)]);

    assert.deepEqual(
      searchStyleGalleryVisualIndex(index, { mode: 'palette', scope: 'source', color: '#ef2030' }),
      searchStyleGalleryVisualIndex(index, { mode: 'palette', scope: 'source', color: '#ef2030', range: 50 }),
    );
    assert.ok(
      searchStyleGalleryVisualIndex(index, { mode: 'palette', scope: 'source', color: '#ef2030', range: 100 }).length >=
        searchStyleGalleryVisualIndex(index, { mode: 'palette', scope: 'source', color: '#ef2030', range: 0 }).length,
    );
    assert.equal(
      searchStyleGalleryVisualIndex(upsertStyleGalleryVisualRecords(index, [record(red, 'exact', red.imageHash)]), {
        mode: 'combined',
        scope: 'source',
        feature: red,
        range: 0,
      })[0].sourceSlug,
      'exact',
    );
  });

  it('requires semantic or palette corroboration for a single perceptual-hash collision', () => {
    const query = feature('a'.repeat(64), 0, [240, 32, 48]);
    const trueVariant = { ...feature('b'.repeat(64), 0, [235, 36, 52]), imageHash: 'b'.repeat(64) };
    const collision = {
      ...feature('c'.repeat(64), 1, [32, 64, 240]),
      perceptualHash: query.perceptualHash,
    };
    const index = upsertStyleGalleryVisualRecords(emptyIndex(), [
      record(trueVariant, 'true-variant', trueVariant.imageHash),
      record(collision, 'hash-collision', collision.imageHash),
    ]);
    const slugs = searchStyleGalleryVisualIndex(index, {
      mode: 'near-duplicate',
      scope: 'source',
      feature: query,
      range: 100,
    }).map((result) => result.sourceSlug);

    assert.ok(slugs.includes('true-variant'));
    assert.ok(!slugs.includes('hash-collision'));
  });
});
