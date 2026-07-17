import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CharacterQuoteError, fetchCharacterQuote } from './character-quote';

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe('fetchCharacterQuote', () => {
  it('requests one random quote for the configured character', async () => {
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
        ]);
      },
      retries: 0,
    });

    const url = new URL(requestedUrl);
    assert.equal(url.searchParams.get('character'), 'Yukino Yukinoshita');
    assert.equal(url.searchParams.get('random'), '1');
    assert.equal(quote.character, 'Yukino Yukinoshita');
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
