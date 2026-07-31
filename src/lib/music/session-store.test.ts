import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptNeteaseSession, encryptNeteaseSession, type NeteaseSession } from './session-store';

test('encrypts the complete NetEase session and rejects a different encryption key', () => {
  const previous = process.env.MUSIC_SESSION_ENCRYPTION_KEY;
  const session: NeteaseSession = {
    version: 1,
    cookie: 'MUSIC_U=secret-session-cookie',
    loginMethod: 'qr',
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    account: { userId: 123, nickname: 'music-account' },
  };

  try {
    process.env.MUSIC_SESSION_ENCRYPTION_KEY = 'a'.repeat(48);
    const encrypted = encryptNeteaseSession(session);
    assert.equal(new TextDecoder().decode(encrypted).includes('MUSIC_U'), false);
    assert.deepEqual(decryptNeteaseSession(encrypted), session);

    process.env.MUSIC_SESSION_ENCRYPTION_KEY = 'b'.repeat(48);
    assert.throws(() => decryptNeteaseSession(encrypted));
  } finally {
    if (previous === undefined) delete process.env.MUSIC_SESSION_ENCRYPTION_KEY;
    else process.env.MUSIC_SESSION_ENCRYPTION_KEY = previous;
  }
});
