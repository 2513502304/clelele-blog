import assert from 'node:assert/strict';
import test from 'node:test';
import { setStyleGallerySession } from '@lib/style-gallery-github-auth';
import type { AstroCookies } from 'astro';
import { isMusicAdmin, rejectCrossOriginMutation } from './admin-auth';

function createCookieJar(): AstroCookies {
  const values = new Map<string, string>();
  return {
    get(name: string) {
      const value = values.get(name);
      return value === undefined ? undefined : { value };
    },
    set(name: string, value: string) {
      values.set(name, value);
    },
    delete(name: string) {
      values.delete(name);
    },
  } as unknown as AstroCookies;
}

test('allows only the configured GitHub user to administer the music session', () => {
  const previousSecret = process.env.STYLE_GALLERY_SESSION_SECRET;
  const previousAdmin = process.env.MUSIC_ADMIN_GITHUB_ID;
  process.env.STYLE_GALLERY_SESSION_SECRET = 's'.repeat(48);
  process.env.MUSIC_ADMIN_GITHUB_ID = '129171955';

  try {
    const ownerCookies = createCookieJar();
    setStyleGallerySession(ownerCookies, new URL('https://blog.example.test'), {
      id: 129171955,
      login: 'owner',
      avatarUrl: 'https://avatars.example.test/owner.png',
      profileUrl: 'https://github.com/owner',
    });
    assert.equal(isMusicAdmin(ownerCookies), true);

    const visitorCookies = createCookieJar();
    setStyleGallerySession(visitorCookies, new URL('https://blog.example.test'), {
      id: 42,
      login: 'visitor',
      avatarUrl: 'https://avatars.example.test/visitor.png',
      profileUrl: 'https://github.com/visitor',
    });
    assert.equal(isMusicAdmin(visitorCookies), false);
  } finally {
    if (previousSecret === undefined) delete process.env.STYLE_GALLERY_SESSION_SECRET;
    else process.env.STYLE_GALLERY_SESSION_SECRET = previousSecret;
    if (previousAdmin === undefined) delete process.env.MUSIC_ADMIN_GITHUB_ID;
    else process.env.MUSIC_ADMIN_GITHUB_ID = previousAdmin;
  }
});

test('rejects cross-origin music session mutations', () => {
  const requestUrl = new URL('https://blog.example.test/api/music/session/health');
  const crossOrigin = new Request(requestUrl, { method: 'POST', headers: { origin: 'https://attacker.example' } });
  const sameOrigin = new Request(requestUrl, { method: 'POST', headers: { origin: requestUrl.origin } });

  assert.equal(rejectCrossOriginMutation(crossOrigin, requestUrl)?.status, 403);
  assert.equal(rejectCrossOriginMutation(sameOrigin, requestUrl), null);
});
