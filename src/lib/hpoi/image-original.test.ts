import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import sharp from 'sharp';
import { createHpoiImageProxyUrl } from './image';
import { cacheHpoiOriginal } from './image-original';

test('original JPEG and PNG uploads retain every byte, native dimensions and MIME type', async () => {
  const originalFetch = globalThis.fetch;
  const names = ['HF_S3_ACCESS_KEY_ID', 'HF_S3_SECRET_ACCESS_KEY', 'HF_S3_ENDPOINT'] as const;
  const env = names.map((name) => process.env[name]);
  process.env.HF_S3_ACCESS_KEY_ID = 'test';
  process.env.HF_S3_SECRET_ACCESS_KEY = 'test';
  process.env.HF_S3_ENDPOINT = 'https://storage.test/test';
  let uploaded = Buffer.alloc(0),
    contentType: string | null = null;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'HEAD') return new Response(null, { status: 404 });
    assert.equal(init?.method, 'PUT');
    uploaded = Buffer.from(init.body as ArrayBuffer);
    contentType = new Headers(init.headers).get('content-type');
    return new Response(null);
  };
  try {
    for (const format of ['jpeg', 'png'] as const) {
      const bytes = await sharp({ create: { width: 750, height: 1050, channels: 3, background: '#abcdef' } })
        .toFormat(format)
        .toBuffer();
      const extension = format === 'jpeg' ? 'jpg' : format;
      const record = await cacheHpoiOriginal(`https://rfx.hpoi.net/gk/pic/n/test.${extension}`, bytes);
      assert.deepEqual(uploaded, bytes, 'no crop, resize or recompression may enter the upload');
      assert.equal(contentType, `image/${format}`);
      assert.equal(record.key, `objects/${createHash('sha256').update(bytes).digest('hex')}.${extension}`);
      assert.equal(record.width, 750);
      assert.equal(record.height, 1050);
      const route = `/api/hpoi/cached-image?key=${record.key.slice(8)}`;
      assert.equal(createHpoiImageProxyUrl(route), route);
      const panel = await cacheHpoiOriginal(`https://rfx.hpoi.net/gk/pic/n/test.${extension}`, bytes, {
        left: 10,
        top: 20,
        width: 600,
        height: 800,
      });
      assert.equal(panel.key, record.key, 'poster viewports must not produce another encoded image');
      assert.equal(panel.sourceWidth, 750);
      assert.equal(panel.width, 600);
    }
    for (const path of ['cover/n', 'pic/s'])
      await assert.rejects(cacheHpoiOriginal(`https://rfx.hpoi.net/gk/${path}/test.jpg`, Buffer.alloc(0)), /pic\/n/);
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, index) => {
      if (env[index] === undefined) delete process.env[name];
      else process.env[name] = env[index];
    });
  }
});
