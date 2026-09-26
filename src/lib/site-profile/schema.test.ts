import assert from 'node:assert/strict';
import { it } from 'node:test';
import { RequestTooLargeError, readBoundedBody } from '../read-bounded-body';
import { appendSiteAssetHistory, bannerSlot, profileFieldsSchema, type SiteProfile, siteProfileSchema } from './schema';

const link = { id: 'link-1', label: 'Link', text: 'Example', url: 'https://example.com', icon: 'ri:link', color: '#ff477e' };
it('retires the oldest inactive history entry without losing active images or the new upload', () => {
  const history = Array.from({ length: 500 }, (_, i) => ({
    key: `images/${i.toString(16).padStart(64, '0')}.png`,
    name: `${i}`,
    width: 10,
    height: 10,
    uploadedAt: '2026-09-26T00:00:00Z',
  }));
  const asset = { ...history[0], key: `images/${'f'.repeat(64)}.png` };
  const profile = { history, assets: { home: history[0].key, avatar: history[1].key } } as SiteProfile;
  const next = appendSiteAssetHistory(profile, asset);
  assert.equal(next.length, 500);
  assert.ok(next.some((entry) => entry.key === history[0].key));
  assert.ok(next.some((entry) => entry.key === history[1].key));
  assert.ok(!next.some((entry) => entry.key === history[2].key));
  assert.equal(next.at(-1)?.key, asset.key);
  assert.equal(profile.history.length, 500);
});
it('accepts extensible contacts and rejects script/protocol-relative links and duplicate IDs', () => {
  assert.equal(profileFieldsSchema.parse({ name: 'A', signature: 'one\ntwo', links: [link] }).signature, 'one\ntwo');
  for (const url of ['javascript:alert(1)', '//evil.example', '/\\evil.example', 'data:text/html,x'])
    assert.equal(profileFieldsSchema.safeParse({ name: 'A', signature: '', links: [{ ...link, url }] }).success, false);
  assert.equal(profileFieldsSchema.safeParse({ name: 'A', signature: '', links: [link, link] }).success, false);
});
it('only publishes existing history keys and requires avatar and home fallback', () => {
  const key = `images/${'a'.repeat(64)}.png`;
  const profile = {
    version: 1,
    revision: '0b6964a3-f2db-4555-9383-d600bcaa448d',
    updatedAt: '2026-09-26T00:00:00.000Z',
    name: 'A',
    signature: '',
    links: [],
    assets: { avatar: key, home: key },
    history: [{ key, name: 'x', uploadedAt: '2026-09-26T00:00:00.000Z', width: 10, height: 10 }],
  };
  assert.ok(siteProfileSchema.safeParse(profile).success);
  assert.equal(siteProfileSchema.safeParse({ ...profile, history: [] }).success, false);
  assert.equal(siteProfileSchema.safeParse({ ...profile, assets: {} }).success, false);
});
it('maps locale and nested paths to stable banner slots', () => {
  assert.equal(bannerSlot('/'), 'home');
  assert.equal(bannerSlot('/en/weekly'), 'weekly');
  assert.equal(bannerSlot('/ja/image-style-prompt-gallery/abc'), 'gallery');
  assert.equal(bannerSlot('/some-post'), 'posts');
});
it('rejects oversized chunked bodies before accumulating the complete payload', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(10));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request('https://example.com', { method: 'POST', body, duplex: 'half' } as RequestInit);
  await assert.rejects(() => readBoundedBody(request, 15), RequestTooLargeError);
  assert.ok(cancelled);
});
