import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { it } from 'node:test';
import type { StoredStyleGalleryItem, StyleGalleryExample, StyleGalleryExampleIndex } from '@/types/style-gallery';
import { POST } from '../pages/api/style-gallery/merge';
import { toStyleGalleryExampleIndexEntry } from './style-gallery-examples';
import { createManualStyleGalleryItem } from './style-gallery-manual-item';
import { buildGalleryMerge } from './style-gallery-merge-plan';
import type { GalleryMergePreview, GalleryMergeSelection } from './style-gallery-merge-types';
import { STYLE_GALLERY_PLATFORMS } from './style-gallery-platforms';
import { toStyleGalleryCatalogItem, toStyleGalleryPromptSearchEntry } from './style-gallery-schema';
import { getStoredStyleGalleryItem, invalidateStyleGalleryStoreCache } from './style-gallery-store';
import { upsertStyleGalleryVisualRecords } from './style-gallery-visual-index';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fixture = () => {
  const cards = ['left', 'right'].map((name, i) =>
    createManualStyleGalleryItem(
      {
        imageHash: hash(name),
        extension: 'png',
        dimensions: { width: 30, height: 40 },
        prompt: `Generated ${name}\nSecond paragraph`,
        originalPrompt: `Original ${name}`,
        model: `Model ${i}`,
      },
      new Date(`2026-09-0${i + 1}T08:00:00Z`),
    ),
  ) as [StoredStyleGalleryItem, StoredStyleGalleryItem];
  const example = (id: string, identity: string): StyleGalleryExample => ({
    id,
    src: `/api/style-gallery/image/examples/images/${hash(identity)}.png`,
    imageHash: hash(identity),
    alt: id,
    model: 'GPT-Image',
    uploadedAt: '2026-09-10T00:00:00Z',
  });
  cards[0].examples = [example('left-shared', 'shared'), example('left-only', 'left-only')];
  cards[1].examples = [example('right-shared', 'shared'), example('right-only', 'right-only')];
  const index: StyleGalleryExampleIndex = {
    version: 2,
    updatedAt: '2026-09-10T00:00:00Z',
    groups: cards.map((item, i) => ({
      sourceSlug: item.slug,
      examples: item.examples.map((image) => ({
        ...toStyleGalleryExampleIndexEntry(image),
        likedBy: i === 0 ? [7, 8] : [8, 9],
      })),
    })),
  };
  const choice: GalleryMergeSelection = {
    keep: 0,
    date: 1,
    prompts: cards.map((item, side) => ({ side: side as 0 | 1, id: item.prompts[0].id })),
    original: { side: 1, id: cards[1].prompts[0].id },
    examples: [0, 1],
    tags: ['插画', '现实'],
  };
  return { cards, index, choice };
};

it('combines only selected facts, deduplicates example votes, and supports a single group or no examples', () => {
  const { cards, index, choice } = fixture();
  const combined = buildGalleryMerge(cards, choice, index);
  assert.equal(combined.item.slug, cards[0].slug);
  assert.equal(combined.item.date, cards[1].date);
  assert.equal(combined.item.prompts.length, 2);
  assert.ok(combined.item.prompts.every((prompt) => prompt.originalPrompt === 'Original right'));
  assert.equal(combined.item.examples.length, 3);
  assert.deepEqual(combined.group.examples[0].likedBy, [7, 8, 9]);
  assert.equal(combined.remappedIds.get('right-shared'), 'left-shared');
  const one = buildGalleryMerge(
    cards,
    { ...choice, keep: 1, examples: [1], prompts: [choice.prompts[1]], original: null },
    index,
  );
  assert.equal(one.item.slug, cards[1].slug);
  assert.equal(one.item.examples.length, 2);
  assert.equal(one.item.prompts[0].originalPrompt, undefined);
  assert.equal(buildGalleryMerge(cards, { ...choice, examples: [] }, index).group.examples.length, 0);
  assert.throws(() => buildGalleryMerge(cards, { ...choice, prompts: [] }, index), /at least one/);
  assert.throws(() => buildGalleryMerge(cards, { ...choice, prompts: [{ side: 0, id: hash('missing') }] }, index), /Selection/);
});

it('authenticates two-card comparison, rejects stale choices, rolls back conflicts and publishes consistent indexes and redirects', async () => {
  const config = {
    STYLE_GALLERY_UPLOAD_TOKEN: 'test-token',
    HF_S3_ACCESS_KEY_ID: 'TEST',
    HF_S3_SECRET_ACCESS_KEY: 'test-secret',
    HF_S3_ENDPOINT: 'https://s3.hf.co/clelele0722',
    HF_S3_BUCKET: 'raw-datasets',
    STYLE_GALLERY_BUCKET_PREFIX: 'image-style-prompt-gallery',
  };
  const previous = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]));
  Object.assign(process.env, config);
  const oldFetch = globalThis.fetch;
  const objects = new Map<string, string>();
  const versions = new Map<string, number>();
  const { cards, index, choice } = fixture();
  const put = (key: string, value: unknown) => {
    objects.set(key, JSON.stringify(value));
    versions.set(key, (versions.get(key) ?? 0) + 1);
  };
  const read = (key: string) => JSON.parse(objects.get(key) ?? '{}');
  cards.forEach((item) => {
    put(`items/${item.slug}.json`, item);
  });
  put('metadata/catalog-v5.json', {
    version: 5,
    updatedAt: index.updatedAt,
    modelTargets: STYLE_GALLERY_PLATFORMS.map((platform) => platform.label),
    items: cards.map(toStyleGalleryCatalogItem),
  });
  put('metadata/prompt-search-index.json', {
    version: 1,
    updatedAt: index.updatedAt,
    entries: Object.fromEntries(cards.map((item) => [item.slug, toStyleGalleryPromptSearchEntry(item)])),
  });
  put('examples/index-v2.json', index);
  put('metadata/tags-v1.json', { version: 1, items: { [cards[0].slug]: ['插画'], [cards[1].slug]: ['现实'] } });
  const records = cards
    .flatMap((item) => [
      ...item.images.map((image) => ({
        kind: 'source' as const,
        sourceSlug: item.slug,
        imageId: image.imageHash,
        imageHash: image.imageHash,
      })),
      ...item.examples.map((image) => ({
        kind: 'example' as const,
        sourceSlug: item.slug,
        imageId: image.id,
        imageHash: image.imageHash,
      })),
    ])
    .map(({ imageHash, ...record }) => ({
      ...record,
      feature: {
        imageHash,
        perceptualHash: '0'.repeat(16),
        differenceHash: '0'.repeat(16),
        palette: Buffer.alloc(24).toString('base64'),
        embedding: Buffer.alloc(384, 1).toString('base64'),
      },
    }));
  put(
    'metadata/visual-index-v1.json',
    upsertStyleGalleryVisualRecords(
      {
        version: 1,
        updatedAt: index.updatedAt,
        model: { id: 'Xenova/dinov2-small', dimensions: 384, quantization: 'int8-unit' },
        features: [],
        records: [],
      },
      records,
    ),
  );
  let requests = 0;
  let conflictKey = '';
  let lostResponseKey = '';
  let missingEtagKey = '';
  globalThis.fetch = async (input, init) => {
    requests++;
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const key = decodeURIComponent(url.pathname.split('/image-style-prompt-gallery/')[1] ?? '');
    const value = objects.get(key);
    const etag = `"${versions.get(key) ?? 0}"`;
    if (init?.method === 'PUT') {
      if (conflictKey === key) {
        conflictKey = '';
        put(key, { ...read(key), concurrent: 'preserve-me' });
        return new Response(null, { status: 412 });
      }
      const headers = new Headers(init.headers);
      if ((headers.has('if-match') && headers.get('if-match') !== etag) || (headers.get('if-none-match') === '*' && value))
        return new Response(null, { status: 412 });
      const body = init.body;
      assert.ok(body instanceof ArrayBuffer || ArrayBuffer.isView(body));
      const bytes =
        body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
      put(key, JSON.parse(new TextDecoder().decode(bytes)));
      if (lostResponseKey === key) {
        lostResponseKey = '';
        throw new TypeError('Simulated lost response after committed PUT');
      }
      if (missingEtagKey === key) {
        missingEtagKey = '';
        return new Response(null);
      }
      return new Response(null, { headers: { etag: `"${versions.get(key)}"` } });
    }
    return value ? new Response(value, { headers: { etag } }) : new Response(null, { status: 404 });
  };
  const send = (body: unknown, token = 'test-token') =>
    POST({
      request: new Request('https://example.test/api/style-gallery/merge', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    } as never);
  const hashes = cards.map((item) => item.imageHash.slice(0, 12));
  try {
    assert.equal((await send({ action: 'preview', hashes }, 'wrong')).status, 401);
    assert.equal(requests, 0);
    assert.equal((await send({ action: 'preview', hashes: [hashes[0]] })).status, 400);
    assert.equal((await send({ action: 'preview', hashes: [hashes[0], hashes[0]] })).status, 400);
    const preview: GalleryMergePreview = await (await send({ action: 'preview', hashes })).json();
    assert.equal(preview.cards[1].likeCounts['right-shared'], 2);
    const body = { action: 'merge', hashes, revisions: preview.cards.map((card) => card.revision), selection: choice };
    assert.equal((await send({ ...body, revisions: ['0'.repeat(64), body.revisions[1]] })).status, 409);
    assert.equal((await send({ ...body, selection: { ...choice, tags: ['不存在'] } })).status, 400);
    const originalCatalog = objects.get('metadata/catalog-v5.json');
    const originalLeft = objects.get(`items/${cards[0].slug}.json`);
    conflictKey = 'metadata/tags-v1.json';
    assert.equal((await send(body)).status, 409);
    assert.equal(objects.get('metadata/catalog-v5.json'), originalCatalog);
    assert.equal(objects.get(`items/${cards[0].slug}.json`), originalLeft);
    assert.deepEqual(read('examples/index-v2.json'), JSON.parse(JSON.stringify(index)));
    assert.equal(read('metadata/tags-v1.json').concurrent, 'preserve-me');
    // A catalog conflict happens after the donor redirect was written: both original details must be restored.
    conflictKey = 'metadata/catalog-v5.json';
    lostResponseKey = `items/${cards[0].slug}.json`;
    assert.equal((await send(body)).status, 409);
    assert.deepEqual(read(`items/${cards[1].slug}.json`), cards[1]);
    assert.equal(objects.get(`items/${cards[0].slug}.json`), originalLeft);
    missingEtagKey = `items/${cards[0].slug}.json`;
    const success = await send(body);
    assert.equal(success.status, 200, await success.clone().text());
    const result = await success.json();
    assert.equal(result.slug, cards[0].slug);
    assert.equal(read('metadata/catalog-v5.json').items.length, 1);
    assert.equal(read('metadata/catalog-v5.json').items[0].exampleCount, 3);
    assert.equal(read(`items/${cards[0].slug}.json`).prompts.length, 2);
    assert.deepEqual(read(`items/${cards[1].slug}.json`), { mergedInto: cards[0].slug });
    assert.deepEqual(read('metadata/tags-v1.json').items, { [cards[0].slug]: ['插画', '现实'] });
    assert.equal(Object.keys(read('metadata/prompt-search-index.json').entries).length, 1);
    assert.deepEqual(read('examples/index-v2.json').groups[0].examples[0].likedBy, [7, 8, 9]);
    const visual = read('metadata/visual-index-v1.json');
    assert.equal(visual.records.length, 4);
    assert.ok(visual.records.every((record: { sourceSlug: string }) => record.sourceSlug === cards[0].slug));
    assert.equal((await getStoredStyleGalleryItem(cards[1].slug))?.slug, cards[0].slug);
    assert.equal(await getStoredStyleGalleryItem(cards[1].slug, { fresh: true }), null);
    assert.equal((await send(body)).status, 400); // retired identity cannot be replayed into a second merge
    assert.ok([...objects.keys()].some((key) => key.startsWith('merge-backups/')));
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    invalidateStyleGalleryStoreCache();
  }
});
