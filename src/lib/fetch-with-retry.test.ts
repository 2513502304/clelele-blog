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
