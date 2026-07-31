import assert from 'node:assert/strict';
import test from 'node:test';
import { getNeteaseAudioBitrate, parseNeteaseAccountStatus } from './netease-api';

test('parses the nested account status returned by the Enhanced API', () => {
  assert.deepEqual(
    parseNeteaseAccountStatus({
      data: {
        code: 200,
        account: { id: 123 },
        profile: { userId: 123, nickname: 'music-user' },
      },
    }),
    { authenticated: true, userId: 123, nickname: 'music-user' },
  );

  assert.deepEqual(parseNeteaseAccountStatus({ code: 301, account: null, profile: null }), {
    authenticated: false,
    userId: undefined,
    nickname: undefined,
  });
});

test('maps configured quality levels to bitrates supported by song_url', () => {
  assert.equal(getNeteaseAudioBitrate('standard'), 128_000);
  assert.equal(getNeteaseAudioBitrate('exhigh'), 320_000);
  assert.equal(getNeteaseAudioBitrate('lossless'), 999_000);
  assert.equal(getNeteaseAudioBitrate('jymaster'), 999_000);
  assert.equal(getNeteaseAudioBitrate('unknown'), 999_000);
});
