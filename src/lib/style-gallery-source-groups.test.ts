import assert from 'node:assert/strict';
import test from 'node:test';
import type { StyleGalleryExampleOverviewItem } from '@/types/style-gallery';
import { getStyleGallerySourceCards, getStyleGallerySourceHash } from './style-gallery-source-groups';

const examples = ['a', 'b', 'a', 'c', 'b'].map(
  (sourceSlug, index) => ({ id: String(index), sourceSlug }) as StyleGalleryExampleOverviewItem,
);
test('source folding emits one card per source without changing member or first-occurrence order', () => {
  const cards = getStyleGallerySourceCards(examples, () => true);
  assert.deepEqual(
    cards.map((card) => card.example.id),
    ['0', '1', '3'],
  );
  assert.deepEqual(
    cards[0].stack?.map((example) => example.id),
    ['0', '2'],
  );
  assert.deepEqual(
    cards[1].stack?.map((example) => example.id),
    ['1', '4'],
  );
  assert.deepEqual(
    getStyleGallerySourceCards(examples, (slug) => slug === 'a').map((card) => card.example.id),
    ['0', '1', '3', '4'],
  );
  assert.deepEqual(
    getStyleGallerySourceCards(examples.slice(2), () => true)[0].stack?.map((example) => example.id),
    ['2'],
  );
  assert.deepEqual(
    getStyleGallerySourceCards(examples, () => false).map((card) => card.example.id),
    examples.map((example) => example.id),
  );
});
test('source labels retain the complete short hash and remove only the redundant title prefix', () => {
  assert.equal(
    getStyleGallerySourceHash({ sourceSlug: '2026-09-01-4eaf44ebd787', sourceTitle: 'Style Prompt 4eaf44ebd787' }),
    '4eaf44ebd787',
  );
  assert.equal(getStyleGallerySourceHash({ sourceSlug: 'custom', sourceTitle: 'Style Prompt custom title' }), 'custom title');
});
