import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getLive2DPackageManifest,
  Live2DAssetPathError,
  normalizeLive2DAssetKey,
  resolveLive2DAsset,
  resolveLive2DPackageAsset,
} from './asset-registry';
import { createLive2DAssetOriginReader, getLive2DReadS3Config, Live2DReadCredentialsError } from './assets';

const releaseId = '9e95d66201f07e339bd5542b1dd0d67ae1bd0b0f9b14a7335ca0bad6bd5916ad';
const relativePath = 'data/expressions/default.exp.json';
const asset = resolveLive2DPackageAsset(releaseId, relativePath);

function assetResponse(bytes = new Uint8Array(asset.size), init: ResponseInit = {}): Response {
  return new Response(bytes, {
    ...init,
    headers: {
      'content-length': String(bytes.byteLength),
      'content-type': asset.mime,
      ...init.headers,
    },
  });
}

test('read configuration rejects missing credentials with a typed error', async () => {
  for (const env of [{}, { LIVE2D_HF_S3_READ_ACCESS_KEY_ID: 'HFAKTEST' }, { LIVE2D_HF_S3_READ_SECRET_ACCESS_KEY: 'secret' }]) {
    assert.throws(() => getLive2DReadS3Config(env), Live2DReadCredentialsError);
  }

  let fetchCount = 0;
  const reader = createLive2DAssetOriginReader({
    config: () => getLive2DReadS3Config({}),
    fetch: async () => {
      fetchCount += 1;
      return assetResponse();
    },
  });
  await assert.rejects(reader.read(asset), Live2DReadCredentialsError);
  assert.equal(fetchCount, 0);
});

test('normalizes one immutable key and resolves exact manifest membership', () => {
  const key = `releases/${releaseId}/${relativePath}`;
  assert.equal(normalizeLive2DAssetKey(key), key);
  assert.equal(resolveLive2DAsset(key).sha256, asset.sha256);
  assert.equal(getLive2DPackageManifest(releaseId)?.objects.length, 74);
});

for (const invalidPath of [
  `releases/${releaseId}/../model.json`,
  `releases/${releaseId}/%2e%2e/model.json`,
  `releases/${releaseId}//model.json`,
  `releases/${releaseId}/data\\model.moc`,
  `/releases/${releaseId}/model.json`,
]) {
  test(`rejects unsafe asset path: ${invalidPath}`, () => {
    assert.throws(() => normalizeLive2DAssetKey(invalidPath), Live2DAssetPathError);
  });
}

test('rejects unknown releases and non-manifest members', () => {
  assert.throws(() => resolveLive2DAsset(`releases/${'a'.repeat(64)}/model.json`), /Unknown Live2D release/);
  assert.throws(() => resolveLive2DAsset(`releases/${releaseId}/missing.bin`), /not present/);
});

test('origin retries transient failures with a fresh signal and streams exact bytes', async () => {
  const signals: AbortSignal[] = [];
  const redirects: RequestRedirect[] = [];
  const reader = createLive2DAssetOriginReader({
    config: () => ({
      accessKeyId: 'HFAKTEST',
      secretAccessKey: 'secret',
      endpoint: new URL('https://s3.hf.co/clelele0722'),
      bucket: 'raw-datasets',
      prefix: 'bestdori',
      region: 'us-east-1',
    }),
    attempts: 2,
    retryDelay: async () => undefined,
    fetch: async (_input, init) => {
      signals.push(init?.signal as AbortSignal);
      redirects.push(init?.redirect ?? 'follow');
      if (signals.length === 1) throw new TypeError('temporary network failure');
      return assetResponse();
    },
  });
  const response = await reader.read(asset);
  assert.equal((await response.arrayBuffer()).byteLength, asset.size);
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
  assert.deepEqual(redirects, ['follow', 'follow']);
});

test('origin does not retry a permanent missing object', async () => {
  let fetchCount = 0;
  const reader = createLive2DAssetOriginReader({
    config: () => ({
      accessKeyId: 'HFAKTEST',
      secretAccessKey: 'secret',
      endpoint: new URL('https://s3.hf.co/clelele0722'),
      bucket: 'raw-datasets',
      prefix: 'bestdori',
      region: 'us-east-1',
    }),
    attempts: 3,
    fetch: async () => {
      fetchCount += 1;
      return new Response(null, { status: 404 });
    },
  });
  await assert.rejects(reader.read(asset));
  assert.equal(fetchCount, 1);
});

test('origin accepts a missing CAS content type and serves the manifest MIME separately', async () => {
  const reader = createLive2DAssetOriginReader({
    config: () => ({
      accessKeyId: 'HFAKTEST',
      secretAccessKey: 'secret',
      endpoint: new URL('https://s3.hf.co/clelele0722'),
      bucket: 'raw-datasets',
      prefix: 'bestdori',
      region: 'us-east-1',
    }),
    fetch: async () =>
      new Response(new Uint8Array(asset.size), {
        headers: { 'content-length': String(asset.size) },
      }),
  });
  const response = await reader.read(asset);
  assert.equal((await response.arrayBuffer()).byteLength, asset.size);
});

test('each visitor gets an independent origin stream without Response clone buffering', async () => {
  let fetchCount = 0;
  let releaseFetch: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  const reader = createLive2DAssetOriginReader({
    config: () => ({
      accessKeyId: 'HFAKTEST',
      secretAccessKey: 'secret',
      endpoint: new URL('https://s3.hf.co/clelele0722'),
      bucket: 'raw-datasets',
      prefix: 'bestdori',
      region: 'us-east-1',
    }),
    fetch: async () => {
      fetchCount += 1;
      await gate;
      return assetResponse();
    },
  });
  const first = reader.read(asset);
  const second = reader.read(asset);
  releaseFetch?.();
  const [firstResponse, secondResponse] = await Promise.all([first, second]);
  const [firstBytes, secondBytes] = await Promise.all([firstResponse.arrayBuffer(), secondResponse.arrayBuffer()]);
  assert.equal(fetchCount, 2);
  assert.equal(firstBytes.byteLength, asset.size);
  assert.equal(secondBytes.byteLength, asset.size);
});

test('origin reads enforce a bounded abort-aware queue', async () => {
  const reader = createLive2DAssetOriginReader({
    config: () => ({
      accessKeyId: 'HFAKTEST',
      secretAccessKey: 'secret',
      endpoint: new URL('https://s3.hf.co/clelele0722'),
      bucket: 'raw-datasets',
      prefix: 'bestdori',
      region: 'us-east-1',
    }),
    maxConcurrentReads: 1,
    maxQueuedReads: 1,
    fetch: async () => assetResponse(),
  });
  const first = await reader.read(asset);
  const queuedController = new AbortController();
  const queued = reader.read(asset, queuedController.signal);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reader.inFlightCount, 2);
  await assert.rejects(reader.read(asset), /queue is full/);
  queuedController.abort(new DOMException('Visitor disconnected.', 'AbortError'));
  await assert.rejects(queued, { name: 'AbortError' });
  assert.equal(reader.inFlightCount, 1);
  await first.body?.cancel();
  assert.equal(reader.inFlightCount, 0);
});

test('origin read slots are handed to queued readers before a new acquisition can race in', async () => {
  let fetchCount = 0;
  const reader = createLive2DAssetOriginReader({
    config: () => ({
      accessKeyId: 'HFAKTEST',
      secretAccessKey: 'secret',
      endpoint: new URL('https://s3.hf.co/clelele0722'),
      bucket: 'raw-datasets',
      prefix: 'bestdori',
      region: 'us-east-1',
    }),
    maxConcurrentReads: 1,
    maxQueuedReads: 2,
    fetch: async () => {
      fetchCount += 1;
      return assetResponse();
    },
  });
  const first = await reader.read(asset);
  const second = reader.read(asset);
  await new Promise((resolve) => setImmediate(resolve));

  const firstCancellation = first.body?.cancel();
  const third = reader.read(asset);
  await new Promise((resolve) => setImmediate(resolve));
  const fetchCountDuringHandoff = fetchCount;

  await firstCancellation;
  const secondResponse = await second;
  await secondResponse.body?.cancel();
  const thirdResponse = await third;
  await thirdResponse.body?.cancel();

  assert.equal(fetchCountDuringHandoff, 2);
  assert.equal(fetchCount, 3);
  assert.equal(reader.inFlightCount, 0);
});
