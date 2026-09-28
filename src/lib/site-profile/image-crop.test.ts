import assert from 'node:assert/strict';
import { it } from 'node:test';
import { cropRectangle, profileFrameRatio } from './image-crop';
import { removeSiteAssetHistory, type SiteProfile } from './schema';

it('keeps pan and zoom inside portrait, landscape and tiny originals without empty strips', () => {
  for (const [width, height] of [
    [4096, 2763],
    [500, 3000],
    [1, 1],
  ])
    for (const ratio of [0.4, 1, 2.7, 6])
      for (const zoom of [1, 2, 4])
        for (const x of [-10, -1, 0, 1, 10]) {
          const crop = cropRectangle(width, height, ratio, { zoom, x, y: -x });
          assert.ok(crop.x >= -1e-10 && crop.y >= -1e-10);
          assert.ok(crop.x + crop.width <= width + 1e-10 && crop.y + crop.height <= height + 1e-10);
          assert.ok(Math.abs(crop.width / crop.height - ratio) < 1e-10);
        }
});
it('matches a circular avatar and the live cover heights including the large-screen ceiling', () => {
  assert.equal(profileFrameRatio('avatar', 1512, 870), 1);
  assert.equal(profileFrameRatio('home', 1512, 870), 1512 / (870 * 0.6));
  assert.equal(profileFrameRatio('weekly', 1512, 870), 1512 / (870 * 0.7));
  assert.equal(profileFrameRatio('home', 3000, 2000), 3000 / 800);
});
it('cannot retire any active asset and keeps deletion idempotent without mutating the source', () => {
  const profile = {
    assets: { avatar: 'a', home: 'b', music: 'c' },
    history: ['a', 'b', 'c', 'd'].map((key) => ({ key })),
  } as SiteProfile;
  for (const key of ['a', 'b', 'c']) assert.throws(() => removeSiteAssetHistory(profile, key));
  assert.deepEqual(
    removeSiteAssetHistory(profile, 'd').map((asset) => asset.key),
    ['a', 'b', 'c'],
  );
  assert.equal(removeSiteAssetHistory(profile, 'missing').length, 4);
  assert.equal(profile.history.length, 4);
});
