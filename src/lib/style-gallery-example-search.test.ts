import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createStyleGalleryExampleQueryMatcher,
  createStyleGalleryExampleSourceSearchText,
} from './style-gallery-example-search';

const example = {
  sourceSlug: '2026-08-24-cf28ae72c887',
  sourceTitle: 'Style Prompt cf28ae72c887',
  note: 'PixAI generation',
};

describe('sub-gallery example text search', () => {
  it('matches the complete prompt shared by the parent item', () => {
    const sourceSearchIndex = {
      [example.sourceSlug]: createStyleGalleryExampleSourceSearchText({
        title: example.sourceTitle,
        prompts: ['默认风格提示词', '创作一幅横向约 7:5 的可爱冒险游戏同人风插画'],
      }),
    };

    assert.equal(createStyleGalleryExampleQueryMatcher(sourceSearchIndex, '可爱冒险游戏同人风插画')(example), true);
  });

  it('continues to match source titles and per-example notes', () => {
    assert.equal(createStyleGalleryExampleQueryMatcher({}, 'cf28ae72c887')(example), true);
    assert.equal(createStyleGalleryExampleQueryMatcher({}, 'pixai generation')(example), true);
    assert.equal(createStyleGalleryExampleQueryMatcher({}, 'not present')(example), false);
  });
});
