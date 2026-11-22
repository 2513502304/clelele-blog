import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { it } from 'node:test';
import sharp from 'sharp';
import { GET, POST } from '../pages/api/style-gallery/generations/[slug]';
import {
  draftImageKey,
  listGenerationJobs,
  markGeneration,
  noteOutput,
  recoverGeneration,
  reserveGeneration,
  runReservedGeneration,
} from './style-gallery-generation-jobs';
import { readPixAIResult, submitGeneration } from './style-gallery-generation-provider';
import { defaultSettings, generationRequest } from './style-gallery-generation-settings';
import { isAllowedStyleGalleryImageKey } from './style-gallery-image-key';

it('reserves a paid request once across tabs and recovers the original after interrupted state writes', async (t) => {
  const env = {
    HF_S3_ACCESS_KEY_ID: 'fixture',
    HF_S3_SECRET_ACCESS_KEY: 'fixture',
    HF_S3_ENDPOINT: 'https://generation.invalid',
    HF_S3_BUCKET: 'fixture',
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
  const itemSlug = 'generation-test';
  const owner = createHash('sha256').update('gallery-studio-v1:gpt-image:visitor-test-key').digest('hex');
  const slug = `${itemSlug}/${owner}`;
  const request = {
    id: randomUUID(),
    prompt: 'A small blue teapot.',
    settings: { ...defaultSettings('gpt-image'), count: 4 as const },
  };
  const objects = new Map<string, { bytes: Uint8Array<ArrayBuffer>; etag: string }>();
  let revision = 0;
  let chargedPosts = 0;
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin === 'https://api.openai.com') {
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer visitor-test-key');
      chargedPosts++;
      return Response.json({ data: Array.from({ length: 4 }, () => ({ b64_json: bytes.toString('base64') })) });
    }
    assert.equal(url.hostname, 'generation.invalid');
    const key = url.pathname.slice('/fixture/gallery/'.length);
    const obj = objects.get(key);
    if (init?.method === 'PUT') {
      const body = new Uint8Array(await new Response(init.body).arrayBuffer());
      const current = objects.get(key),
        headers = new Headers(init.headers);
      if ((headers.has('if-none-match') && current) || (headers.has('if-match') && headers.get('if-match') !== current?.etag))
        return new Response(null, { status: 412 });
      const etag = `"revision-${++revision}"`;
      objects.set(key, { bytes: body, etag });
      return new Response(null, { headers: { etag } });
    }
    if (!obj) return new Response(null, { status: 404 });
    return new Response(init?.method === 'HEAD' ? null : obj.bytes, { headers: { etag: obj.etag } });
  });
  const reservations = await Promise.all([reserveGeneration(slug, request), reserveGeneration(slug, request)]);
  assert.equal(reservations.filter(Boolean).length, 1);
  await assert.rejects(reserveGeneration(slug, { ...request, prompt: 'new prompt' }), /different settings/);
  await runReservedGeneration(slug, request, 'visitor-test-key');
  const [ready] = await listGenerationJobs(slug);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.prompt, request.prompt);
  const endpoint = 'https://studio.invalid/api/style-gallery/generations/generation-test';
  async function call(headers: Record<string, string>, body?: object, query = '') {
    const req = new Request(endpoint + query, { headers, ...(body && { method: 'POST', body: JSON.stringify(body) }) });
    return (body ? POST : GET)({ params: { slug: itemSlug }, request: req });
  }
  const visitor = { 'x-gallery-provider': 'gpt-image', 'x-api-key': 'visitor-test-key' };
  const history = await call(visitor);
  assert.equal((await history.json()).jobs[0].id, request.id);
  assert.match(history.headers.get('cache-control') ?? '', /no-store/);
  assert.equal((await call({ authorization: 'Bearer gallery-upload-only' })).status, 401);
  for (const other of [
    { ...visitor, 'x-api-key': 'another-key' },
    { ...visitor, 'x-gallery-provider': 'pixai' },
  ]) {
    assert.deepEqual((await (await call(other)).json()).jobs, []);
    assert.equal((await call(other, undefined, `?preview=${request.id}`)).status, 404);
  }
  assert.equal((await call(visitor, { action: 'confirm', id: request.id })).status, 403);
  assert.equal((await call({ ...visitor, 'x-gallery-provider': 'pixai' }, { action: 'create', ...request })).status, 400);
  assert.ok(!JSON.stringify([...objects.keys()]).includes('visitor-test-key'));
  assert.ok(!JSON.stringify(ready).includes('visitor-test-key'));

  assert.equal(chargedPosts, 1);
  const key = draftImageKey(slug, request.id);
  assert.equal(isAllowedStyleGalleryImageKey(key), false);
  const image = objects.get(key);
  assert.ok(image);
  assert.deepEqual(Buffer.from(image.bytes), bytes);

  // Simulate a crash after checkpointing bytes but before advancing the manifest.
  const manifest = objects.get(`generation-drafts/${slug}/jobs.json`);
  assert.ok(manifest);
  manifest.bytes = new TextEncoder().encode(JSON.stringify([{ ...ready, available: [], state: 'running' }]));
  const [interrupted] = await listGenerationJobs(slug);
  await recoverGeneration(slug, interrupted, 'visitor-test-key');
  assert.equal((await listGenerationJobs(slug))[0].state, 'ready');
  await Promise.all([noteOutput(slug, request.id, 1, true), noteOutput(slug, request.id, 2, true)]);
  const [partial] = await listGenerationJobs(slug);
  assert.equal(partial.state, 'ready');
  assert.deepEqual(partial.published?.toSorted(), [1, 2]);
  await Promise.all([noteOutput(slug, request.id, 0, true), noteOutput(slug, request.id, 3, true)]);
  await markGeneration(slug, request.id, { state: 'ready' });
  assert.equal((await listGenerationJobs(slug))[0].state, 'saved');
  assert.equal(await reserveGeneration(slug, request), false);
  assert.equal(chargedPosts, 1);
});

it('rejects invalid platform/model combinations before submission', () => {
  const base = { id: randomUUID(), prompt: 'Test', settings: defaultSettings('pixai') };
  assert.ok(generationRequest.safeParse(base).success);
  for (const change of [{ platform: 'flux' }, { model: 'gpt-image-2' }, { size: '8k' }, { mode: 'unsupported' }])
    assert.equal(generationRequest.safeParse({ ...base, settings: { ...base.settings, ...change } }).success, false);
  for (const settings of [
    { ...defaultSettings('gpt-image'), model: 'gpt-image-1.5', size: '3840x2160' },
    { ...defaultSettings('gpt-image'), format: 'jpeg', background: 'transparent' },
    { ...defaultSettings('gpt-image'), quality: 'high', format: 'png', compression: 30 },
    { ...defaultSettings('pixai'), count: 2 },
    { ...defaultSettings('pixai'), mode: 'lite' },
    { ...defaultSettings('pixai'), model: 'Tsubaki.2', mode: 'lite', negativePrompt: 'invalid' },
    { ...defaultSettings('pixai'), seed: 4294967296 },
  ])
    assert.equal(generationRequest.safeParse({ ...base, settings }).success, false);
  assert.equal(generationRequest.safeParse({ ...base, prompt: '   ' }).success, false);
});

it('resumes a private PixAI task and downloads the original without sharing the API key with the CDN', async (t) => {
  const paths: string[] = [];
  let available = false;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    paths.push(url.pathname);
    if (url.host === 'api.pixai.art') {
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-only');
      if (url.pathname === '/v2/image/create') {
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.modelVersionId, '2024383379556065549');
        assert.equal(payload.promptHelper, 'disable');
        assert.equal(payload.batchSize, 1);
        return Response.json({ taskId: 'preserved' });
      }
      if (url.pathname === '/v1/task/preserved')
        return Response.json({ id: 'preserved', status: available ? 'completed' : 'running', outputs: { mediaId: 'image' } });
      if (url.pathname === '/v1/media/image')
        return Response.json({
          urls: [
            { variant: 'THUMBNAIL', url: 'https://pixai.art/thumb' },
            { variant: 'ORIGINAL', url: 'https://d2doj8oszwtcqy.cloudfront.net/original' },
          ],
        });
    }
    assert.equal(url.pathname, '/original');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return new Response('original');
  });
  const result = await submitGeneration(
    { id: randomUUID(), prompt: 'Teapot', settings: defaultSettings('pixai') },
    'fixture-only',
  );
  assert.ok('taskId' in result);
  const originals: string[] = [];
  const keep = async (index: number, bytes: Buffer) => {
    originals[index] = bytes.toString();
  };
  assert.equal(await readPixAIResult(result.taskId, 'fixture-only', keep), null);
  available = true;
  assert.equal(await readPixAIResult(result.taskId, 'fixture-only', keep), 1);
  assert.deepEqual(originals, ['original']);
  assert.equal(paths.filter((path) => path === '/v2/image/create').length, 1);
});
