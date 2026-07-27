import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLive2DAssetOriginReader,
  createLive2DAssetRequestHook,
  getLive2DPackageManifest,
  Live2DAssetDeliveryError,
  Live2DAssetPathError,
  Live2DAssetSessionCircuitBreaker,
  normalizeLive2DAssetKey,
  resolveLive2DAsset,
  resolveLive2DPackageAsset,
  runLive2DDirectCanary,
} from './assets';

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

function resourceRequest(path = relativePath, signal = new AbortController().signal) {
  return {
    path,
    url: new URL(path, 'https://clelele-blog.vercel.app/'),
    signal,
    referrerPolicy: 'no-referrer' as const,
  };
}

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

test('manifest rejection happens before browser fetch', async () => {
  let fetchCount = 0;
  const hook = createLive2DAssetRequestHook({
    releaseId,
    directBaseUrl: new URL('https://direct.example/bestdori/'),
    fallbackBaseUrl: new URL('https://blog.example/api/live2d-assets/'),
    fetch: async () => {
      fetchCount += 1;
      return assetResponse();
    },
  });
  await assert.rejects(hook(resourceRequest('../secret')), Live2DAssetPathError);
  assert.equal(fetchCount, 0);
});

test('direct network failure falls back once and opens the session circuit breaker', async () => {
  const calls: string[] = [];
  const circuit = new Live2DAssetSessionCircuitBreaker();
  const hook = createLive2DAssetRequestHook({
    releaseId,
    directBaseUrl: new URL('https://direct.example/bestdori/'),
    fallbackBaseUrl: new URL('https://blog.example/api/live2d-assets/'),
    circuitBreaker: circuit,
    fetch: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://direct.example/')) throw new TypeError('CORS blocked');
      return assetResponse();
    },
  });

  assert.equal((await hook(resourceRequest())).status, 200);
  assert.equal(circuit.reason, 'network');
  assert.equal((await hook(resourceRequest())).status, 200);
  assert.equal(calls.filter((url) => url.startsWith('https://direct.example/')).length, 1);
  assert.equal(calls.filter((url) => url.startsWith('https://blog.example/')).length, 2);
});

for (const reason of ['cors', 'redirect', 'timeout', 'http', 'mime'] as const) {
  test(`direct ${reason} failure falls back and records one stable classification`, async () => {
    let fetchCount = 0;
    const circuit = new Live2DAssetSessionCircuitBreaker();
    const hook = createLive2DAssetRequestHook({
      releaseId,
      directBaseUrl: new URL('https://direct.example/bestdori/'),
      fallbackBaseUrl: new URL('https://blog.example/api/live2d-assets/'),
      circuitBreaker: circuit,
      fetch: async () => {
        fetchCount += 1;
        if (fetchCount > 1) return assetResponse();
        if (reason === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
        if (reason === 'http') return new Response(null, { status: 503 });
        if (reason === 'mime') return assetResponse(undefined, { headers: { 'content-type': 'text/html' } });
        const response = assetResponse();
        Object.defineProperty(response, reason === 'cors' ? 'type' : 'redirected', {
          configurable: true,
          value: reason === 'cors' ? 'opaque' : true,
        });
        return response;
      },
    });
    assert.equal((await hook(resourceRequest())).status, 200);
    assert.equal(fetchCount, 2);
    assert.equal(circuit.reason, reason);
  });
}

test('permanent fallback failure never loops back to direct', async () => {
  let fetchCount = 0;
  const hook = createLive2DAssetRequestHook({
    releaseId,
    directBaseUrl: new URL('https://direct.example/bestdori/'),
    fallbackBaseUrl: new URL('https://blog.example/api/live2d-assets/'),
    circuitBreaker: new Live2DAssetSessionCircuitBreaker(),
    fetch: async () => {
      fetchCount += 1;
      return new Response(null, { status: 503 });
    },
  });
  await assert.rejects(hook(resourceRequest()), /returned 503/);
  assert.equal(fetchCount, 2);
});

test('fallback network failure is classified once without another direct attempt', async () => {
  let fetchCount = 0;
  const hook = createLive2DAssetRequestHook({
    releaseId,
    directBaseUrl: new URL('https://direct.example/bestdori/'),
    fallbackBaseUrl: new URL('https://blog.example/api/live2d-assets/'),
    directEnabled: false,
    fetch: async () => {
      fetchCount += 1;
      throw new TypeError('fallback unavailable');
    },
  });
  await assert.rejects(
    hook(resourceRequest()),
    (error: unknown) => error instanceof Live2DAssetDeliveryError && error.reason === 'fallback',
  );
  assert.equal(fetchCount, 1);
});

test('unsupported no-referrer starts on fallback without probing direct', async () => {
  const calls: string[] = [];
  const hook = createLive2DAssetRequestHook({
    releaseId,
    directBaseUrl: new URL('https://direct.example/bestdori/'),
    fallbackBaseUrl: new URL('https://blog.example/api/live2d-assets/'),
    referrerPolicySupported: false,
    circuitBreaker: new Live2DAssetSessionCircuitBreaker(),
    fetch: async (input) => {
      calls.push(String(input));
      return assetResponse();
    },
  });
  await hook(resourceRequest());
  assert.deepEqual(
    calls.map((url) => new URL(url).origin),
    ['https://blog.example'],
  );
});

test('generation abort and integrity failures never fall back', async () => {
  for (const scenario of ['abort', 'integrity'] as const) {
    let fetchCount = 0;
    const controller = new AbortController();
    if (scenario === 'abort') controller.abort();
    const hook = createLive2DAssetRequestHook({
      releaseId,
      directBaseUrl: new URL('https://direct.example/bestdori/'),
      fallbackBaseUrl: new URL('https://blog.example/api/live2d-assets/'),
      circuitBreaker: new Live2DAssetSessionCircuitBreaker(),
      fetch: async () => {
        fetchCount += 1;
        if (scenario === 'abort') throw new DOMException('Aborted', 'AbortError');
        return assetResponse(new Uint8Array(asset.size + 1));
      },
    });
    await assert.rejects(
      hook(resourceRequest(relativePath, controller.signal)),
      (error: unknown) =>
        error instanceof Live2DAssetDeliveryError && error.reason === (scenario === 'abort' ? 'aborted' : 'integrity'),
    );
    assert.equal(fetchCount, scenario === 'abort' ? 0 : 1);
  }
});

test('origin retries transient failures with a fresh signal and streams exact bytes', async () => {
  const signals: AbortSignal[] = [];
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
      if (signals.length === 1) throw new TypeError('temporary network failure');
      return assetResponse();
    },
  });
  const response = await reader.read(asset);
  assert.equal((await response.arrayBuffer()).byteLength, asset.size);
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
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

test('concurrent cold reads for one immutable key share one origin request', async () => {
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
  assert.equal(fetchCount, 1);
  assert.equal(firstBytes.byteLength, asset.size);
  assert.equal(secondBytes.byteLength, asset.size);
});

test('a slightly staggered request still joins the bounded cold-read window', async () => {
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
    fetch: async () => {
      fetchCount += 1;
      return assetResponse();
    },
  });
  const first = await reader.read(asset);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await reader.read(asset);
  await Promise.all([first.arrayBuffer(), second.arrayBuffer()]);
  assert.equal(fetchCount, 1);
});

test('direct canary treats digest mismatch as permanent instead of silently falling back', async () => {
  const manifest = getLive2DPackageManifest(releaseId);
  assert.ok(manifest);
  const first = manifest.objects[0];
  let fetchCount = 0;
  await assert.rejects(
    runLive2DDirectCanary({
      releaseId,
      directBaseUrl: new URL('https://direct.example/bestdori/'),
      circuitBreaker: new Live2DAssetSessionCircuitBreaker(),
      fetch: async () => {
        fetchCount += 1;
        return new Response(new Uint8Array(first.size), {
          headers: { 'content-length': String(first.size), 'content-type': first.mime },
        });
      },
    }),
    (error: unknown) => error instanceof Live2DAssetDeliveryError && error.reason === 'integrity',
  );
  assert.equal(fetchCount, 1);
});
