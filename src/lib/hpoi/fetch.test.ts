import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { fetchHpoiCollectionState } from './fetch';

const originalFetch = globalThis.fetch;

function collectionPage(ids: string[], pageCount?: number): string {
  const items = ids
    .map(
      (id) => `
        <div class="item">
          <a class="cover" href="/hobby/${id}"><img src="https://rfx.hpoi.net/cover-${id}.jpg"></a>
          <a class="name" href="/hobby/${id}" title="Hpoi ${id}">Hpoi ${id}</a>
        </div>
      `,
    )
    .join('');

  return `
    <div class="hpoi-collect-container">
      <div class="collect-hobby-list-small">${items}</div>
    </div>
    ${pageCount === undefined ? '' : `<script>var query = { page: '1', pageCount: '${pageCount}' };</script>`}
  `;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fetchHpoiCollectionState', () => {
  it('loads every Hpoi lazy-loaded page and removes duplicate items', async () => {
    const requestedPages: number[] = [];
    globalThis.fetch = async (_input, init) => {
      if (!init?.body) return new Response(collectionPage(['1'], 3));

      const body = new URLSearchParams(String(init.body));
      const page = Number(body.get('page'));
      requestedPages.push(page);
      assert.equal(body.get('part'), 'true');
      assert.equal(body.get('favState'), 'buy');
      assert.equal(body.get('view'), '2');

      return new Response(page === 2 ? collectionPage(['2']) : collectionPage(['1', '3']));
    };

    const items = await fetchHpoiCollectionState('783694', 'buy');

    assert.deepEqual(requestedPages.sort(), [2, 3]);
    assert.deepEqual(
      items.map((item) => item.id),
      ['1', '2', '3'],
    );
  });
});
