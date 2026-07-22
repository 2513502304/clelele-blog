import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AstroCookies } from 'astro';
import {
  authenticateStyleGalleryGitHubUser,
  createStyleGalleryOAuthFlow,
  getStyleGalleryOAuthChallenge,
  getStyleGalleryViewer,
  isStyleGalleryGitHubAuthEnabled,
  normalizeStyleGalleryReturnTo,
  setStyleGalleryOAuthFlowCookie,
  setStyleGallerySession,
  takeStyleGalleryOAuthFlow,
} from './style-gallery-github-auth';

function createCookies(): AstroCookies {
  const values = new Map<string, string>();
  return {
    get: (name: string) => (values.has(name) ? { value: values.get(name) } : undefined),
    set: (name: string, value: string) => values.set(name, value),
    delete: (name: string) => values.delete(name),
  } as unknown as AstroCookies;
}

describe('style gallery GitHub login session', () => {
  it('signs short-lived OAuth state and persistent viewer cookies', () => {
    const previous = process.env.STYLE_GALLERY_SESSION_SECRET;
    process.env.STYLE_GALLERY_SESSION_SECRET = 'test-secret-that-is-longer-than-thirty-two-characters';
    try {
      const cookies = createCookies();
      const url = new URL('https://blog.example.com/image-style-prompt-gallery/examples');
      const flow = createStyleGalleryOAuthFlow('/image-style-prompt-gallery/examples?sort=likes');
      assert.equal(getStyleGalleryOAuthChallenge(flow.verifier).length, 43);
      setStyleGalleryOAuthFlowCookie(cookies, url, flow);
      assert.deepEqual(takeStyleGalleryOAuthFlow(cookies), flow);
      assert.equal(takeStyleGalleryOAuthFlow(cookies), null);

      const viewer = {
        id: 2513502304,
        login: 'clelele',
        name: 'clelele',
        avatarUrl: 'https://avatars.githubusercontent.com/u/2513502304',
        profileUrl: 'https://github.com/2513502304',
      };
      setStyleGallerySession(cookies, url, viewer);
      assert.deepEqual(getStyleGalleryViewer(cookies), viewer);
    } finally {
      if (previous === undefined) delete process.env.STYLE_GALLERY_SESSION_SECRET;
      else process.env.STYLE_GALLERY_SESSION_SECRET = previous;
    }
  });

  it('rejects external return URLs', () => {
    assert.equal(normalizeStyleGalleryReturnTo('https://evil.example/path'), '/image-style-prompt-gallery/examples');
    assert.equal(normalizeStyleGalleryReturnTo('//evil.example/path'), '/image-style-prompt-gallery/examples');
    assert.equal(
      normalizeStyleGalleryReturnTo('/image-style-prompt-gallery/examples#item'),
      '/image-style-prompt-gallery/examples#item',
    );
  });

  it('stays disabled until the complete server-side OAuth configuration is present', () => {
    const keys = [
      'STYLE_GALLERY_GITHUB_CLIENT_ID',
      'STYLE_GALLERY_GITHUB_CLIENT_SECRET',
      'STYLE_GALLERY_GITHUB_REDIRECT_URI',
      'STYLE_GALLERY_SESSION_SECRET',
    ] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      for (const key of keys) process.env[key] = key === 'STYLE_GALLERY_SESSION_SECRET' ? 'x'.repeat(32) : 'configured';
      assert.equal(isStyleGalleryGitHubAuthEnabled(), true);
      delete process.env.STYLE_GALLERY_GITHUB_REDIRECT_URI;
      assert.equal(isStyleGalleryGitHubAuthEnabled(), false);
    } finally {
      for (const key of keys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('exchanges the OAuth code as form-encoded PKCE data', async () => {
    const originalFetch = globalThis.fetch;
    const previousClientId = process.env.STYLE_GALLERY_GITHUB_CLIENT_ID;
    const previousClientSecret = process.env.STYLE_GALLERY_GITHUB_CLIENT_SECRET;
    process.env.STYLE_GALLERY_GITHUB_CLIENT_ID = 'client-id';
    process.env.STYLE_GALLERY_GITHUB_CLIENT_SECRET = 'client-secret';
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      if (String(input).includes('/login/oauth/access_token')) {
        return Response.json({ access_token: 'token', token_type: 'bearer' });
      }
      return Response.json({
        id: 2513502304,
        login: 'clelele',
        name: 'clelele',
        avatar_url: 'https://avatars.githubusercontent.com/u/2513502304',
        html_url: 'https://github.com/2513502304',
      });
    };

    try {
      await authenticateStyleGalleryGitHubUser({
        code: 'temporary-code',
        verifier: 'pkce-verifier',
        redirectUri: 'https://blog.example.com/api/style-gallery/auth/github/callback',
      });
      const tokenRequest = requests[0];
      assert.equal(new Headers(tokenRequest.init?.headers).get('content-type'), 'application/x-www-form-urlencoded');
      assert.ok(tokenRequest.init?.body instanceof URLSearchParams);
      assert.deepEqual(Object.fromEntries(tokenRequest.init.body), {
        client_id: 'client-id',
        client_secret: 'client-secret',
        code: 'temporary-code',
        redirect_uri: 'https://blog.example.com/api/style-gallery/auth/github/callback',
        code_verifier: 'pkce-verifier',
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (previousClientId === undefined) delete process.env.STYLE_GALLERY_GITHUB_CLIENT_ID;
      else process.env.STYLE_GALLERY_GITHUB_CLIENT_ID = previousClientId;
      if (previousClientSecret === undefined) delete process.env.STYLE_GALLERY_GITHUB_CLIENT_SECRET;
      else process.env.STYLE_GALLERY_GITHUB_CLIENT_SECRET = previousClientSecret;
    }
  });
});
