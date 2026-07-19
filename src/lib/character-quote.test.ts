import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CharacterQuoteError, fetchCharacterQuote } from './character-quote';

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe('fetchCharacterQuote', () => {
  it('requests all quotes for the configured character and selects one locally', async () => {
    let requestedUrl = '';
    const quote = await fetchCharacterQuote('Yukino Yukinoshita', {
      fetcher: async (input) => {
        requestedUrl = String(input);
        return jsonResponse([
          {
            character: 'Yukino Yukinoshita',
            quote: 'People fail because they do not understand the hard work necessary to be successful.',
            show: 'Yahari Ore No Seishun Love Come Wa Machigatteiru',
          },
          {
            character: 'Yukino Yukinoshita',
            quote: 'People are not all perfect.',
            show: 'Yahari Ore No Seishun Love Come Wa Machigatteiru',
          },
        ]);
      },
      random: () => 0.75,
      retries: 0,
    });

    const url = new URL(requestedUrl);
    assert.equal(url.searchParams.get('character'), 'Yukino Yukinoshita');
    assert.equal(url.searchParams.has('random'), false);
    assert.equal(quote.quote, 'People are not all perfect.');
  });

  it('reuses the cached collection while selecting a fresh random quote', async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      return jsonResponse([
        { character: 'Yukino', quote: 'First quote', show: 'Oregairu' },
        { character: 'Yukino', quote: 'Second quote', show: 'Oregairu' },
      ]);
    };

    const first = await fetchCharacterQuote('Yukino', { fetcher, random: () => 0 });
    const second = await fetchCharacterQuote('Yukino', { fetcher, random: () => 0.99 });

    assert.equal(attempts, 1);
    assert.equal(first.quote, 'First quote');
    assert.equal(second.quote, 'Second quote');
  });

  it('coalesces concurrent cache misses for the same character', async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return jsonResponse([{ character: 'Yukino', quote: 'Shared quote', show: 'Oregairu' }]);
    };

    const [first, second] = await Promise.all([
      fetchCharacterQuote('Yukino concurrent', { fetcher }),
      fetchCharacterQuote('Yukino concurrent', { fetcher }),
    ]);

    assert.equal(attempts, 1);
    assert.equal(first.quote, 'Shared quote');
    assert.equal(second.quote, 'Shared quote');
  });

  it('retries transient failures before returning a validated quote', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const quote = await fetchCharacterQuote('Lelouch', {
      fetcher: async () => {
        attempts += 1;
        if (attempts === 1) return new Response('unavailable', { status: 503 });
        return jsonResponse([
          { character: 'Lelouch Lamperouge', quote: 'The only ones who should kill...', show: 'Code Geass' },
        ]);
      },
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    });

    assert.equal(attempts, 2);
    assert.deepEqual(delays, [250]);
    assert.equal(quote.show, 'Code Geass');
  });

  it('does not retry non-retryable upstream failures', async () => {
    let attempts = 0;

    await assert.rejects(
      () =>
        fetchCharacterQuote('Yukino', {
          fetcher: async () => {
            attempts += 1;
            return new Response('bad request', { status: 400 });
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof CharacterQuoteError);
        assert.equal(error.status, 502);
        return true;
      },
    );

    assert.equal(attempts, 1);
  });

  it('rejects missing characters and malformed upstream responses', async () => {
    await assert.rejects(
      () => fetchCharacterQuote('   '),
      (error: unknown) => {
        assert.ok(error instanceof CharacterQuoteError);
        assert.equal(error.status, 400);
        return true;
      },
    );

    await assert.rejects(
      () =>
        fetchCharacterQuote('Yukino', {
          fetcher: async () => jsonResponse([{ character: 'Yukino', quote: '', show: 'Oregairu' }]),
          retries: 0,
        }),
      /temporarily unavailable/,
    );
  });
});
