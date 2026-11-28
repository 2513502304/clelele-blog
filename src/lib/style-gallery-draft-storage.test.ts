import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStyleGallerySignedImageUrl,
  createStyleGallerySignedImageUrls,
  createStyleGallerySignedUploadUrl,
  fetchStyleGalleryDraftOriginal,
  getStyleGalleryObjectText,
  headStyleGalleryObject,
  putStyleGalleryObject,
} from './hf-s3-presign';

test('private reads and writes wait for migration and never issue public draft links', async (t) => {
  const env = {
    HF_S3_ACCESS_KEY_ID: 'fixture',
    HF_S3_SECRET_ACCESS_KEY: 'fixture',
    HF_S3_ENDPOINT: 'https://storage.invalid',
    HF_S3_BUCKET: 'public',
    STYLE_GALLERY_DRAFTS_BUCKET: 'private',
    STYLE_GALLERY_BUCKET_PREFIX: 'gallery',
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  const draft = 'generation-drafts/owner/example.image';
  const publicImage = 'examples/images/public.webp';
  assert.equal(new URL(createStyleGallerySignedImageUrl(publicImage)).pathname, `/public/gallery/${publicImage}`);
  assert.throws(() => createStyleGallerySignedImageUrls([publicImage, draft]), /authenticated preview/);
  assert.throws(() => createStyleGallerySignedUploadUrl(draft), /authenticated preview/);
  assert.throws(() => createStyleGallerySignedImageUrl(draft), /authenticated preview/);

  let markerStatus = 404;
  let checks = 0;
  let objectStatus = 200;
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname === '/private/gallery/operations/gallery-drafts-ready-v1') {
      checks++;
      assert.equal(init?.method, 'HEAD');
      return new Response(null, { status: markerStatus });
    }
    assert.equal(url.pathname, `/private/gallery/${draft}`);
    methods.push(init?.method ?? 'GET');
    return new Response(null, { status: objectStatus });
  });
  await assert.rejects(putStyleGalleryObject(draft, new Uint8Array(), 'image/png'), /awaiting migration/);
  assert.equal(methods.length, 0);
  markerStatus = 200;
  await Promise.all([getStyleGalleryObjectText(draft), fetchStyleGalleryDraftOriginal(draft)]);
  await putStyleGalleryObject(draft, new Uint8Array(), 'image/png');
  assert.deepEqual(methods, ['GET', 'GET', 'PUT']);
  assert.equal(checks, 2);

  objectStatus = 403;
  await assert.rejects(getStyleGalleryObjectText(draft), /403/);
  await assert.rejects(headStyleGalleryObject(draft), /403/);
  objectStatus = 404;
  assert.equal(await getStyleGalleryObjectText(draft), null);
  process.env.STYLE_GALLERY_DRAFTS_BUCKET = env.HF_S3_BUCKET;
  await assert.rejects(getStyleGalleryObjectText(draft), /dedicated private bucket/);
});
