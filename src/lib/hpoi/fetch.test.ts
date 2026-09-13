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
    ${pageCount === undefined ? '' : `<script>var query = { page: 1, pageCount: ${pageCount} };</script>`}
  `;
}

function profilePage(name = 'clelele'): string {
  return `<span class="hpoi-user-nickname">${name}</span>`;
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
      if (!String(input).includes('/hobby')) return new Response(profilePage());
      collectionId += 1;
      return new Response(collectionPage([String(collectionId)]));
    };

    const data = await fetchHpoiCollection('783694');

    assert.deepEqual(data.warnings, []);
    // 六个收藏状态取一半为三个 worker，再加上并行的个人资料请求。
    assert.ok(maxActiveRequests <= 4, `expected at most 4 concurrent requests, received ${maxActiveRequests}`);
  });

  it('retries a blocked profile response and keeps a valid retry warning-free', async () => {
    let profileAttempts = 0;
    globalThis.fetch = async (input) => {
      if (String(input).includes('/hobby')) return new Response(collectionPage(['1']));
      profileAttempts += 1;
      return new Response(profileAttempts === 1 ? '<h1>Request blocked</h1>' : profilePage('clelele'));
    };

    const data = await fetchHpoiCollection('783694');

    assert.equal(profileAttempts, 2);
    assert.equal(data.profile.name, 'clelele');
    assert.deepEqual(data.warnings, []);
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

describe('detail rating enrichment', () => {
  it('cancels slow rating reads at the shared deadline without losing collection cards', async (t) => {
    const timeout = AbortSignal.timeout;
    t.mock.method(AbortSignal, 'timeout', (ms: number) => {
      if (ms !== 20_000) return timeout(ms);
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 30);
      return controller.signal;
    });
    let detailReads = 0;
    globalThis.fetch = async (input, init) => {
      if (/\/hobby\/\d+$/.test(String(input))) {
        detailReads++;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        });
      }
      return new Response(String(input).includes('/hobby') ? collectionPage(['1', '2', '3', '4', '5', '6']) : profilePage());
    };
    const data = await fetchHpoiCollection('783694');
    assert.equal(detailReads, 3);
    assert.equal(data.collections.all.length, 6);
    assert.ok(data.collections.all.every((item) => item.score === null));
  });

  it('fetches each missing figure rating once across all collection states', async () => {
    let detailReads = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/hobby/82123')) {
        detailReads++;
        return new Response(
          '<script type="application/ld+json">{"mainEntity":{"@type":"Product","aggregateRating":{"ratingValue":"4.77","bestRating":"5","ratingCount":"2310"}}}</script>',
        );
      }
      return new Response(url.includes('/hobby') ? collectionPage(['82123']) : profilePage());
    };
    const data = await fetchHpoiCollection('783694');
    assert.equal(detailReads, 1);
    for (const items of Object.values(data.collections)) assert.equal(items[0].score, '4.77');
  });
});
