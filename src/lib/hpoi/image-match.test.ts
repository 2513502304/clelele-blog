import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createHpoiImageProxyUrl } from './image';
import { matchCover } from './image-match';
import { officialImages, readHpoiSource } from './image-source';

for (const [id, expected] of [
  ['85291', 2],
  ['70818', 2],
  ['68456', 1],
  ['128755', 3],
  ['77004', 1],
] as const) {
  test(`cover alignment selects photograph ${expected} for Hpoi ${id}, not a box/back view/collage`, async () => {
    const fixture = (index: number) => readFile(new URL(`../../../tests/fixtures/hpoi/${id}-${index}.jpg`, import.meta.url));
    const cover = await fixture(0);
    const matches = [];
    for (let i = 1; i <= 3; i++) matches.push({ index: i, ...(await matchCover(cover, await fixture(i))) });
    matches.sort((a, b) => b.score - a.score);
    assert.equal(matches[0].index, expected);
    assert.ok(matches[0].score > 0.67);
    assert.ok(matches[0].score - matches[1].score > 0.045);
    assert.ok(matches[0].left >= 0 && matches[0].top >= 0);
    assert.ok(matches[0].left + matches[0].width <= 1.00001);
    assert.ok(matches[0].top + matches[0].height <= 1.00001);
  });
}
test('gallery pagination extracts standalone official anchors and excludes unrelated hosts', () => {
  assert.deepEqual(
    officialImages(
      '{av-masonry-loaded}<a href="https://rfx.hpoi.net/gk/pic/n/a.jpg"></a><a href="https://evil.example/gk/pic/n/b.jpg"></a>',
    ),
    ['https://rfx.hpoi.net/gk/pic/n/a.jpg'],
  );
});
test('cached JPEG addresses bypass the Hpoi proxy, arbitrary paths cannot', () => {
  const url = `/api/hpoi/cached-image?key=${'a'.repeat(64)}.jpg`;
  assert.equal(createHpoiImageProxyUrl(url), url);
  assert.ok(createHpoiImageProxyUrl('/api/private').startsWith('/api/hpoi/image?'));
});
test('source reader rejects private hosts before networking', async () => {
  await assert.rejects(readHpoiSource('https://127.0.0.1/gk/a.jpg'), /Invalid Hpoi source/);
});
