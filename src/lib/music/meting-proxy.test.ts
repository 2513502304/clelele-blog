import assert from 'node:assert/strict';
import test from 'node:test';
import { rewriteMetingSongs } from './meting-proxy';
import { createFallbackAudioUrl, isValidNeteaseSongId } from './service';

test('rewrites only trusted NetEase song IDs and upgrades metadata URLs', () => {
  const [song] = rewriteMetingSongs(
    [
      {
        name: 'Example',
        url: 'http://meting.example.test/?server=netease&type=url&id=3389005906',
        pic: 'http://meting.example.test/?type=pic&id=1',
        lrc: 'http://meting.example.test/?type=lrc&id=1',
      },
    ],
    'netease',
  ) as Record<string, unknown>[];

  assert.equal(song.url, '/api/music/stream?id=3389005906');
  assert.equal(song.pic, 'https://meting.example.test/?type=pic&id=1');
  assert.equal(song.lrc, 'https://meting.example.test/?type=lrc&id=1');
  assert.equal(isValidNeteaseSongId('3389005906'), true);
  assert.equal(isValidNeteaseSongId('../redirect'), false);
});

test('constructs fallback URLs from server configuration instead of client input', () => {
  const previous = process.env.MUSIC_FALLBACK_METING_API;
  process.env.MUSIC_FALLBACK_METING_API = 'https://fallback.example.test/meting';
  try {
    assert.equal(
      createFallbackAudioUrl('3389005906'),
      'https://fallback.example.test/meting?server=netease&type=url&id=3389005906',
    );
  } finally {
    if (previous === undefined) delete process.env.MUSIC_FALLBACK_METING_API;
    else process.env.MUSIC_FALLBACK_METING_API = previous;
  }
});
