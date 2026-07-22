import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { fetchHpoiCollection, fetchHpoiCollectionState } from './fetch';

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

  it('retries a successful HTTP response that contains an upstream block page', async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      return new Response(attempts === 1 ? '<html>temporary block page</html>' : collectionPage(['42']));
    };

    const items = await fetchHpoiCollectionState('783694', 'care');

    assert.equal(attempts, 2);
    assert.deepEqual(
      items.map((item) => item.id),
      ['42'],
    );
  });

  it('drains in-flight pagination workers before rejecting a failed collection state', async () => {
    let activeRequests = 0;
    const requestedPages: number[] = [];
    globalThis.fetch = async (_input, init) => {
      if (!init?.body) return new Response(collectionPage(['1'], 4));

      const page = Number(new URLSearchParams(String(init.body)).get('page'));
      requestedPages.push(page);
      activeRequests += 1;
      if (page === 2) {
        activeRequests -= 1;
        return new Response('temporary upstream failure', { status: 503 });
      }
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      activeRequests -= 1;
      return new Response(collectionPage(['3']));
    };

    await assert.rejects(fetchHpoiCollectionState('783694', 'buy'), /HTTP 503/);
    assert.equal(activeRequests, 0);
    assert.equal(requestedPages.includes(4), false);
  });

  it('limits concurrent collection states so retries do not form a request burst', async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    let collectionId = 0;
    globalThis.fetch = async (input) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeRequests -= 1;
      if (!String(input).includes('/hobby')) return new Response('<html><body></body></html>');
      collectionId += 1;
      return new Response(collectionPage([String(collectionId)]));
    };

    const data = await fetchHpoiCollection('783694');

    assert.deepEqual(data.warnings, []);
    // 六个收藏状态取一半为三个 worker，再加上并行的个人资料请求。
    assert.ok(maxActiveRequests <= 4, `expected at most 4 concurrent requests, received ${maxActiveRequests}`);
  });

  it('handles an early profile failure while collection workers are still running', async () => {
    globalThis.fetch = async (input) => {
      if (!String(input).includes('/hobby')) throw new Error('profile unavailable');
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(collectionPage(['1']));
    };

    const data = await fetchHpoiCollection('783694');

    assert.deepEqual(data.warnings, ['profile']);
    assert.equal(data.collections.care.length, 1);
  });
});
