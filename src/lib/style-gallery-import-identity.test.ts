import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { it } from 'node:test';
import { POST } from '../pages/api/style-gallery/import-identities';
import {
  IMPORT_IDENTITY_KEY,
  rememberImportIdentities,
  replaceImportImageBatch,
  replaceImportImages,
  resolveImportIdentities,
} from './style-gallery-import-identity';
import { createManualStyleGalleryItem } from './style-gallery-manual-item';
import { STYLE_GALLERY_PLATFORMS } from './style-gallery-platforms';
import { toStyleGalleryCatalogItem, toStyleGalleryPromptSearchEntry } from './style-gallery-schema';
import { upsertStyleGalleryVisualRecords } from './style-gallery-visual-index';
import type { StyleGalleryVisualRecordInput } from './style-gallery-visual-types';

it('authenticates alias resolution, preserves merged cards and transactionally replaces only source identity', async () => {
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
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const item = createManualStyleGalleryItem(
    {
      imageHash: hash('old'),
      extension: 'png',
      dimensions: { width: 30, height: 40 },
      prompt: 'preserved',
      originalPrompt: 'original',
      model: 'model',
    },
    new Date('2026-09-01T00:00:00Z'),
  );
  const replacement = createManualStyleGalleryItem(
    { imageHash: hash('new'), extension: 'png', dimensions: { width: 60, height: 80 }, prompt: 'must not overwrite' },
    new Date('2026-09-18T00:00:00Z'),
  );
  const objects = new Map<string, string>();
  const versions = new Map<string, number>();
  const put = (key: string, value: unknown) => {
    objects.set(key, JSON.stringify(value));
    versions.set(key, (versions.get(key) ?? 0) + 1);
  };
  const read = (key: string) => JSON.parse(objects.get(key) ?? 'null');
  put(`items/${item.slug}.json`, item);
  put('items/retired.json', { mergedInto: item.slug });
  put('metadata/catalog-v5.json', {
    version: 5,
    updatedAt: item.date,
    modelTargets: STYLE_GALLERY_PLATFORMS.map((p) => p.label),
    items: [toStyleGalleryCatalogItem(item)],
  });
  put('metadata/prompt-search-index.json', {
    version: 1,
    updatedAt: item.date,
    entries: { [item.slug]: toStyleGalleryPromptSearchEntry(item) },
  });
  const feature = {
    imageHash: replacement.imageHash,
    perceptualHash: '0'.repeat(16),
    differenceHash: '0'.repeat(16),
    palette: Buffer.alloc(24).toString('base64'),
    embedding: Buffer.alloc(384, 1).toString('base64'),
  };
  const records: StyleGalleryVisualRecordInput[] = [
    { kind: 'source', sourceSlug: item.slug, imageId: replacement.imageHash, feature },
  ];
  put(
    'metadata/visual-index-v1.json',
    upsertStyleGalleryVisualRecords(
      {
        version: 1,
        updatedAt: item.date,
        model: { id: 'Xenova/dinov2-small', dimensions: 384, quantization: 'int8-unit' },
        features: [],
        records: [],
      },
      [{ ...records[0], imageId: item.imageHash, feature: { ...feature, imageHash: item.imageHash } }],
    ),
  );
  put('metadata/tags-v1.json', { version: 1, items: { [item.slug]: ['插画'] } });
  put('examples/index-v2.json', { groups: [{ sourceSlug: item.slug, examples: [{ likedBy: [1, 2] }] }] });
  const untouched = [objects.get('metadata/tags-v1.json'), objects.get('examples/index-v2.json')];
  const oldFetch = globalThis.fetch;
  let failKey = '';
  let lostKey = '';
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    requests++;
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const key = decodeURIComponent(url.pathname.split('/image-style-prompt-gallery/')[1] ?? '');
    if (init?.method === 'HEAD') return new Response(null, { status: 200 });
    const value = objects.get(key);
    const etag = `"${versions.get(key) ?? 0}"`;
    if (init?.method === 'PUT') {
      if (failKey === key) {
        failKey = '';
        return new Response(null, { status: 412 });
      }
      const headers = new Headers(init.headers);
      if ((headers.has('if-match') && headers.get('if-match') !== etag) || (headers.get('if-none-match') === '*' && value))
        return new Response(null, { status: 412 });
      const body = init.body;
      assert.ok(body instanceof ArrayBuffer || ArrayBuffer.isView(body));
      put(
        key,
        JSON.parse(
          new TextDecoder().decode(
            body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
          ),
        ),
      );
      if (lostKey === key) {
        lostKey = '';
        throw new TypeError('Lost PUT response');
      }
      return new Response(null, { headers: { etag: `"${versions.get(key)}"` } });
    }
    return value ? new Response(value, { headers: { etag } }) : new Response(null, { status: 404 });
  };
  try {
    const denied = await POST({
      request: new Request('https://example.test/api/style-gallery/import-identities', { method: 'POST', body: '{}' }),
    } as never);
    assert.equal(denied.status, 401);
    assert.equal(requests, 0);
    await rememberImportIdentities([
      {
        hashes: [hash('projection-pending'), replacement.imageHash],
        slug: replacement.slug,
        expectedHash: replacement.imageHash,
      },
    ]);
    assert.equal(
      (await resolveImportIdentities([{ hashes: [hash('projection-pending')], legacySlug: replacement.slug }]))[0],
      null,
    );

    const [resolved] = await resolveImportIdentities([{ hashes: [hash('retired')], legacySlug: 'retired' }]);
    assert.ok(resolved);
    assert.equal(resolved.item.slug, item.slug);
    await rememberImportIdentities([{ hashes: [hash('projection')], slug: 'retired' }]);
    assert.equal(
      (await resolveImportIdentities([{ hashes: [hash('projection')], legacySlug: 'unrelated' }]))[0]?.item.slug,
      item.slug,
    );
    assert.equal((await resolveImportIdentities([{ hashes: [hash('absent')], legacySlug: 'absent' }]))[0], null);
    await assert.rejects(replaceImportImages(item.slug, '0'.repeat(64), replacement, records, [item.imageHash]), /changed/);
    const before = objects.get(`items/${item.slug}.json`);
    failKey = 'metadata/catalog-v5.json';
    lostKey = `items/${item.slug}.json`;
    await assert.rejects(replaceImportImages(item.slug, resolved.revision, replacement, records, [item.imageHash]));
    assert.equal(objects.get(`items/${item.slug}.json`), before);
    assert.equal(read('metadata/catalog-v5.json').items[0].imageHash, item.imageHash);
    const result = await replaceImportImages(item.slug, resolved.revision, replacement, records, [item.imageHash]);
    assert.equal(result.item.slug, item.slug);
    assert.equal(result.item.imageHash, replacement.imageHash);
    assert.equal(
      (await replaceImportImages(item.slug, resolved.revision, replacement, records, [item.imageHash])).changed,
      false,
    );
    assert.deepEqual(result.item.prompts, item.prompts);
    assert.equal(result.item.date, item.date);
    assert.deepEqual([objects.get('metadata/tags-v1.json'), objects.get('examples/index-v2.json')], untouched);
    assert.equal(read(IMPORT_IDENTITY_KEY).hashes[item.imageHash], item.slug);
    const [after] = await resolveImportIdentities([{ hashes: [item.imageHash, replacement.imageHash], legacySlug: item.slug }]);
    assert.ok(after);
    assert.equal(after.item.imageHash, replacement.imageHash);
    assert.equal((await replaceImportImages(item.slug, after.revision, replacement, records, [item.imageHash])).changed, false);
    assert.ok([...objects.keys()].some((key) => key.startsWith('import-backups/')));
    const other = createManualStyleGalleryItem(
      { imageHash: hash('other'), extension: 'png', dimensions: { width: 20, height: 30 }, prompt: 'other prompt' },
      new Date('2026-09-02T00:00:00Z'),
    );
    put(`items/${other.slug}.json`, other);
    const catalog = read('metadata/catalog-v5.json');
    catalog.items.push(toStyleGalleryCatalogItem(other));
    put('metadata/catalog-v5.json', catalog);
    const [otherMatch] = await resolveImportIdentities([{ hashes: [other.imageHash], legacySlug: other.slug }]);
    assert.ok(otherMatch);
    const beforeBatch = objects.get(`items/${item.slug}.json`);
    await assert.rejects(
      replaceImportImageBatch([
        {
          slug: item.slug,
          revision: after.revision,
          item,
          visualRecords: [{ ...records[0], imageId: item.imageHash, feature: { ...feature, imageHash: item.imageHash } }],
          hashes: [item.imageHash],
        },
        {
          slug: other.slug,
          revision: '0'.repeat(64),
          item: replacement,
          visualRecords: [{ ...records[0], sourceSlug: other.slug }],
          hashes: [other.imageHash],
        },
      ]),
      /changed/,
    );
    assert.equal(objects.get(`items/${item.slug}.json`), beforeBatch);
    await assert.rejects(
      resolveImportIdentities([{ hashes: [item.imageHash, other.imageHash], legacySlug: 'unused' }]),
      /separate cards/,
    );
    await assert.rejects(rememberImportIdentities([{ hashes: [item.imageHash], slug: other.slug }]), /another card/);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
