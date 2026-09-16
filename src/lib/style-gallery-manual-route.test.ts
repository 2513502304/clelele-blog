import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { it } from 'node:test';
import sharp from 'sharp';
import { POST as collect } from '../pages/api/style-gallery/manual';
import { PATCH as edit } from '../pages/api/style-gallery/prompts/[slug]';
import { POST as upload } from '../pages/api/style-gallery/source-upload';
import { STYLE_GALLERY_PLATFORMS } from './style-gallery-platforms';
import { invalidateStyleGalleryStoreCache } from './style-gallery-store';
import { encodeQuantizedEmbedding } from './style-gallery-visual-feature';
import { STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION } from './style-gallery-visual-types';

it('manually collects verified source/thumbnail/visual metadata and appends duplicate-image variants idempotently', async () => {
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
  const previousFetch = globalThis.fetch;
  const objects = new Map<string, Uint8Array>();
  const versions = new Map<string, number>();
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  objects.set(
    'metadata/catalog-v5.json',
    encode({
      version: 5,
      updatedAt: new Date().toISOString(),
      modelTargets: STYLE_GALLERY_PLATFORMS.map((p) => p.label),
      items: [],
    }),
  );
  objects.set('metadata/prompt-search-index.json', encode({ version: 1, updatedAt: new Date().toISOString(), entries: {} }));
  let writes = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const key = decodeURIComponent(url.pathname.split('/image-style-prompt-gallery/')[1] ?? '');
    const value = objects.get(key);
    const etag = `"${versions.get(key) ?? 1}"`;
    const headers = new Headers(init?.headers);
    if (init?.method === 'HEAD') return new Response(null, { status: value ? 200 : 404, headers: { etag } });
    if (init?.method === 'PUT') {
      if ((headers.has('if-match') && headers.get('if-match') !== etag) || (headers.get('if-none-match') === '*' && value))
        return new Response(null, { status: 412 });
      const body = init.body;
      assert.ok(body instanceof ArrayBuffer || ArrayBuffer.isView(body));
      objects.set(
        key,
        Uint8Array.from(
          body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
        ),
      );
      versions.set(key, (versions.get(key) ?? 1) + 1);
      writes++;
      return new Response(null, { headers: { etag: `"${versions.get(key)}"` } });
    }
    if (init?.method === 'DELETE') {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return value ? new Response(Uint8Array.from(value), { headers: { etag } }) : new Response(null, { status: 404 });
  };
  try {
    const bytes = await sharp({ create: { width: 48, height: 72, channels: 3, background: '#3399aa' } })
      .png()
      .toBuffer();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const url = new URL(`https://example.test/api/style-gallery/source-upload?action=direct&imageHash=${hash}`);
    const makeUpload = (credential: string, data = bytes) =>
      upload({
        url,
        request: new Request(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${credential}`, 'content-type': 'image/png' },
          body: Uint8Array.from(data),
        }),
      } as never);
    assert.equal((await makeUpload('wrong')).status, 401);
    assert.equal(writes, 0);
    assert.equal((await makeUpload('test-token', Buffer.from('wrong'))).status, 409);
    const invalidBytes = Buffer.from('Not an image');
    const invalidHash = createHash('sha256').update(invalidBytes).digest('hex');
    const sendSource = (target: URL, body: BodyInit, contentType: string) =>
      upload({
        url: target,
        request: new Request(target, {
          method: 'POST',
          headers: { authorization: 'Bearer test-token', 'content-type': contentType },
          body,
        }),
      } as never);
    assert.equal(
      (
        await sendSource(
          new URL(`https://example.test/api/style-gallery/source-upload?action=direct&imageHash=${invalidHash}`),
          invalidBytes,
          'image/png',
        )
      ).status,
      400,
    );
    assert.equal((await sendSource(url, Uint8Array.from(bytes), 'image/jpeg')).status, 400);
    const uploadId = 'e22c3ad4-2528-4a2d-a5c5-60c6481d81a9';
    assert.equal(
      (
        await sendSource(
          new URL(
            `https://example.test/api/style-gallery/source-upload?action=chunk&uploadId=${uploadId}&partIndex=0&partCount=1&chunkHash=${invalidHash}`,
          ),
          invalidBytes,
          'application/octet-stream',
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await sendSource(
          new URL('https://example.test/api/style-gallery/source-upload'),
          JSON.stringify({
            action: 'complete',
            uploadId,
            imageHash: invalidHash,
            extension: 'png',
            contentType: 'image/png',
            size: invalidBytes.length,
            parts: [{ index: 0, size: invalidBytes.length, hash: invalidHash }],
          }),
          'application/json',
        )
      ).status,
      400,
    );
    assert.equal(objects.has(`source/${invalidHash.slice(0, 12)}.png`), false);
    assert.equal(JSON.parse(new TextDecoder().decode(objects.get('metadata/catalog-v5.json'))).items.length, 0);
    assert.equal((await makeUpload('test-token')).status, 200);
    const embedding = new Float32Array(STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION);
    embedding[0] = 1;
    const body = {
      imageHash: hash,
      extension: 'png',
      prompt: 'A collected prompt\nSecond line\n\nThird paragraph',
      originalPrompt: 'Source instruction\nNext instruction',
      model: 'Personal collection',
      tags: ['插画'],
      feature: {
        imageHash: hash,
        perceptualHash: '0'.repeat(16),
        differenceHash: '0'.repeat(16),
        palette: 'A'.repeat(32),
        embedding: encodeQuantizedEmbedding(embedding),
      },
    };
    const save = (data = body, credential = 'test-token') =>
      collect({
        request: new Request('https://example.test/api/style-gallery/manual', {
          method: 'POST',
          headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
          body: JSON.stringify(data),
        }),
      } as never);
    assert.equal((await save(body, 'wrong')).status, 401);
    assert.equal((await save({ ...body, prompt: '' })).status, 400);
    assert.equal((await save({ ...body, feature: { ...body.feature, imageHash: 'b'.repeat(64) } })).status, 400);
    assert.equal((await save({ ...body, tags: ['null'] })).status, 400);
    const response = await save();
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.equal(result.created, true);
    assert.equal(result.visualIndexUpdated, true);
    assert.equal(result.tagsUpdated, true);
    const json = (key: string) => JSON.parse(new TextDecoder().decode(objects.get(key)));
    assert.deepEqual(json('metadata/tags-v1.json').items[result.slug], ['插画']);
    const stored = json(`items/${result.slug}.json`);
    assert.equal(stored.prompts[0].originalPrompt, body.originalPrompt);
    assert.equal(stored.prompts[0].prompt, body.prompt);
    assert.deepEqual(stored.images[0].dimensions, { width: 48, height: 72 });
    assert.equal(stored.date.endsWith('Z'), true);
    const thumbnail = await sharp(objects.get(`thumb/${hash.slice(0, 12)}.webp`)).metadata();
    assert.equal(thumbnail.format, 'webp');
    assert.equal(thumbnail.width, 48);
    assert.equal(json('metadata/visual-index-v1.json').records[0].sourceSlug, result.slug);
    const visual = json('metadata/visual-index-v1.json');
    visual.features.push({ ...body.feature, imageHash: 'b'.repeat(64) });
    visual.records.push({ kind: 'source', sourceSlug: result.slug, imageId: 'b'.repeat(64), featureIndex: 1 });
    objects.set('metadata/visual-index-v1.json', encode(visual));
    versions.set('metadata/visual-index-v1.json', (versions.get('metadata/visual-index-v1.json') ?? 1) + 1);
    invalidateStyleGalleryStoreCache();
    assert.equal((await (await save()).json()).slug, result.slug);
    assert.equal(json('metadata/visual-index-v1.json').records.length, 2);
    assert.ok(
      json('metadata/visual-index-v1.json').records.some((record: { imageId: string }) => record.imageId === 'b'.repeat(64)),
    );
    assert.equal(json(`items/${result.slug}.json`).prompts.length, 1);
    assert.equal((await (await save({ ...body, prompt: 'Another extraction' })).json()).slug, result.slug);
    assert.equal(json(`items/${result.slug}.json`).prompts.length, 2);
    assert.equal(json('metadata/catalog-v5.json').items.length, 1);
    await save({ ...body, tags: ['现实'] });
    assert.deepEqual(json('metadata/tags-v1.json').items[result.slug], ['插画', '现实']);
    await save({ ...body, tags: [] });
    assert.deepEqual(json('metadata/tags-v1.json').items[result.slug], ['插画', '现实']);
    const unchangedId = stored.prompts[0].id;
    const patch = (fields: Record<string, unknown>, credential = 'test-token') =>
      edit({
        params: { slug: result.slug },
        request: new Request(`https://example.test/api/style-gallery/prompts/${result.slug}`, {
          method: 'PATCH',
          headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
          body: JSON.stringify({ id: unchangedId, prompt: body.prompt, ...fields }),
        }),
      } as never);
    const writeCount = writes;
    assert.equal((await patch({ originalPrompt: 'New', previousOriginalPrompt: body.originalPrompt }, 'wrong')).status, 401);
    assert.equal((await patch({ originalPrompt: 'New', previousOriginalPrompt: 'stale' })).status, 409);
    assert.equal(writes, writeCount);
    assert.equal((await patch({ originalPrompt: '', previousOriginalPrompt: body.originalPrompt })).status, 200);
    assert.equal(json(`items/${result.slug}.json`).prompts[0].originalPrompt, undefined);
    assert.equal((await patch({ originalPrompt: 'Added later\nSecond line', previousOriginalPrompt: '' })).status, 200);
    const edited = json(`items/${result.slug}.json`).prompts;
    assert.equal(edited[0].id, unchangedId);
    assert.equal(edited[0].prompt, body.prompt);
    assert.equal(edited[0].originalPrompt, 'Added later\nSecond line');
    assert.equal(edited[1].prompt, 'Another extraction');
    const secondBytes = await sharp({ create: { width: 64, height: 80, channels: 3, background: '#aa3399' } })
      .png()
      .toBuffer();
    const secondHash = createHash('sha256').update(secondBytes).digest('hex');
    objects.set(`source/${secondHash.slice(0, 12)}.png`, secondBytes);
    const images = [
      { imageHash: hash, extension: 'png', feature: body.feature },
      { imageHash: secondHash, extension: 'png', feature: { ...body.feature, imageHash: secondHash } },
    ];
    const groupBody = { images, prompt: 'Shared prompt', tags: ['组合'] };
    const groupResponse = await save(groupBody as never);
    assert.equal(groupResponse.status, 200, await groupResponse.clone().text());
    const groupResult = await groupResponse.json();
    const group = json(`items/${groupResult.slug}.json`);
    assert.equal(group.imageHash, createHash('sha256').update([hash, secondHash].join('\n')).digest('hex'));
    assert.deepEqual(
      group.images.map((image: { imageHash: string }) => image.imageHash),
      [hash, secondHash],
    );
    assert.equal(group.prompts.length, 1);
    assert.equal(
      json('metadata/catalog-v5.json').items.find((item: { slug: string }) => item.slug === groupResult.slug).imageCount,
      2,
    );
    assert.equal(
      json('metadata/visual-index-v1.json').records.filter(
        (record: { sourceSlug: string }) => record.sourceSlug === groupResult.slug,
      ).length,
      2,
    );
    assert.equal((await (await save(groupBody as never)).json()).slug, groupResult.slug);
    assert.equal(json(`items/${groupResult.slug}.json`).prompts.length, 1);
    assert.equal((await save({ ...groupBody, images: [images[0], images[0]] } as never)).status, 400);
    const countBeforeMissing = json('metadata/catalog-v5.json').items.length;
    assert.equal(
      (
        await save({
          ...groupBody,
          images: [
            images[0],
            { ...images[1], imageHash: 'c'.repeat(64), feature: { ...body.feature, imageHash: 'c'.repeat(64) } },
          ],
        } as never)
      ).status,
      400,
    );
    assert.equal(json('metadata/catalog-v5.json').items.length, countBeforeMissing);
  } finally {
    globalThis.fetch = previousFetch;
    invalidateStyleGalleryStoreCache();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
