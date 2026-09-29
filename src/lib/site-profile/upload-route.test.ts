import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { it } from 'node:test';
import { POST } from '../../pages/api/site-profile/admin';

it('preserves the upload conflict response when deleting the unpublished file also fails', async () => {
  const settings = {
    HF_S3_ENDPOINT: 'https://profile-upload-test.invalid',
    HF_S3_ACCESS_KEY_ID: 'test',
    HF_S3_SECRET_ACCESS_KEY: 'test',
    SITE_ADMIN_GITHUB_ID: '129171955',
    STYLE_GALLERY_SESSION_SECRET: 'profile-upload-test-secret-local-only',
  };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  const key = `images/${'a'.repeat(64)}.png`;
  const profile = {
    version: 1,
    revision: '0b6964a3-f2db-4555-9383-d600bcaa448d',
    updatedAt: '2026-09-26T00:00:00Z',
    name: 'A',
    signature: '',
    links: [],
    assets: { avatar: key, home: key },
    history: [{ key, name: 'active.png', uploadedAt: '2026-09-26T00:00:00Z', width: 1, height: 1 }],
  };
  let deletes = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'profile-upload-test.invalid');
    const metadata = url.pathname.endsWith('profile.v1.json');
    if (init?.method === 'DELETE') {
      deletes++;
      return new Response('Delete denied', { status: 400 });
    }
    if (init?.method === 'PUT') return new Response(null, { status: metadata ? 412 : 200 });
    return metadata ? Response.json(profile, { headers: { ETag: '"test-revision"' } }) : new Response(null, { status: 404 });
  };
  console.warn = (...args) => warnings.push(args);
  try {
    const payload = Buffer.from(
      JSON.stringify({
        viewer: { id: 129171955, login: 'test', avatarUrl: 'https://example.com/a.png', profileUrl: 'https://github.com/test' },
        expiresAt: Date.now() + 60_000,
      }),
    ).toString('base64url');
    const signature = createHmac('sha256', settings.STYLE_GALLERY_SESSION_SECRET).update(payload).digest('base64url');
    const form = new FormData();
    form.set('revision', profile.revision);
    form.set(
      'file',
      new File(
        [Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')],
        'test.png',
        { type: 'image/png' },
      ),
    );
    const request = new Request('https://example.com/api/site-profile/admin', { method: 'POST', body: form });
    const result = await POST({
      request,
      url: new URL(request.url),
      cookies: { get: () => ({ value: `${payload}.${signature}` }) },
    } as unknown as Parameters<typeof POST>[0]);
    assert.equal(result.status, 409);
    assert.equal(deletes, 1);
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][1]), /^images\/[a-f0-9]{64}\.png$/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
