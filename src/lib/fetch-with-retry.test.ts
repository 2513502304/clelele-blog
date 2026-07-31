import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWithRetry } from './fetch-with-retry';

test('retries transient responses but returns deterministic client errors immediately', async () => {
  let transientCalls = 0;
  const recovered = await fetchWithRetry('https://example.test/transient', {
    attempts: 3,
    initialBackoffMs: 1,
    fetcher: async () => {
      transientCalls += 1;
      return new Response(null, { status: transientCalls < 3 ? 503 : 200 });
    },
  });
  assert.equal(recovered.status, 200);
  assert.equal(transientCalls, 3);

  let clientErrorCalls = 0;
  const clientError = await fetchWithRetry('https://example.test/missing', {
    attempts: 3,
    initialBackoffMs: 1,
    fetcher: async () => {
      clientErrorCalls += 1;
      return new Response(null, { status: 404 });
    },
  });
  assert.equal(clientError.status, 404);
  assert.equal(clientErrorCalls, 1);
});

test('retries rejected fetches and preserves the final error', async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithRetry('https://example.test/rejected', {
      attempts: 2,
      initialBackoffMs: 1,
      fetcher: async () => {
        calls += 1;
        throw new Error(`network failure ${calls}`);
      },
    }),
    /network failure 2/,
  );
  assert.equal(calls, 2);
});

test('aborts a fetch after its per-attempt timeout', async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithRetry('https://example.test/timeout', {
      attempts: 1,
      timeoutMs: 1,
      fetcher: (_input, init) => {
        calls += 1;
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error('Expected a timeout signal.'));
            return;
          }
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    }),
    (error: unknown) => error instanceof Error && error.name === 'TimeoutError',
  );
  assert.equal(calls, 1);
});

test('retries a 429 response before returning a successful response', async () => {
  let calls = 0;
  const response = await fetchWithRetry('https://example.test/rate-limited', {
    attempts: 2,
    initialBackoffMs: 1,
    fetcher: async () => {
      calls += 1;
      return new Response(null, { status: calls === 1 ? 429 : 200 });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('propagates the status error from the final retryable response', async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithRetry('https://example.test/unavailable', {
      attempts: 2,
      initialBackoffMs: 1,
      fetcher: async () => {
        calls += 1;
        return new Response(null, { status: 503 });
      },
      statusError: (response) => new Error(`upstream ${response.status}`),
    }),
    /upstream 503/,
  );
  assert.equal(calls, 2);
});

test('falls back for invalid options and caps excessive retry attempts', async () => {
  let invalidCalls = 0;
  const recovered = await fetchWithRetry('https://example.test/invalid-options', {
    attempts: Number.NaN,
    timeoutMs: Number.NaN,
    initialBackoffMs: 1,
    fetcher: async () => {
      invalidCalls += 1;
      return new Response(null, { status: invalidCalls < 3 ? 503 : 200 });
    },
  });
  assert.equal(recovered.status, 200);
  assert.equal(invalidCalls, 3);

  let excessiveCalls = 0;
  await assert.rejects(
    fetchWithRetry('https://example.test/excessive-options', {
      attempts: Number.MAX_SAFE_INTEGER,
      timeoutMs: Number.MAX_SAFE_INTEGER,
      initialBackoffMs: 1,
      fetcher: async () => {
        excessiveCalls += 1;
        return new Response(null, { status: 503 });
      },
    }),
    /Request failed with 503/,
  );
  assert.equal(excessiveCalls, 5);
});
