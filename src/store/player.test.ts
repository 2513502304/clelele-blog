import assert from 'node:assert/strict';
import test from 'node:test';
import { $activePlayerId, claimActivePlayer, releaseActivePlayer } from './player';

test('media ownership uses compare-and-clear release', () => {
  claimActivePlayer('live2d');
  claimActivePlayer('article-audio');
  assert.equal(releaseActivePlayer('live2d'), false);
  assert.equal($activePlayerId.get(), 'article-audio');
  assert.equal(releaseActivePlayer('article-audio'), true);
  assert.equal($activePlayerId.get(), null);
});
