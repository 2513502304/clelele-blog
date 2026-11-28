import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { assertHpoiPurchaseOwner, createHpoiPurchaseSource, parseHpoiPurchaseItemId } from './purchases-source';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const menu = (id = '1') =>
  `<ul class="hpoi-navpersonal"><li><a href="/user/${id}">本人</a><a href="/user/${id}/hobby?category=-1">我的收藏</a></li></ul>`;
const detail = `${menu()}<script type="application/ld+json">{"@type":"Product"}</script>
  <a href="/album/new?itemType=hobby&itemId=42">新相册</a><a href="/modal/hobby/republic?itemId=42">再版</a><script>fn.init(fn, 42, 7)</script>`;
const form = `<input type="hidden" name="id" value="101"><input type="hidden" name="itemId" value="42">
  <label><input type="radio" name="state" value="buy" checked>已入</label>
  <input name="orderTime" value=""><input name="orderWay" value=""><input type="number" name="orderMoney" value="">
  <select name="orderMoneyCurrency"><option value="rmb" selected>人民币</option></select>
  <select name="orderForm"><option value="2" selected>现货</option></select><input name="tags"><textarea name="comment"></textarea>`;
const response = (html: string) => new Response(html, { headers: { 'content-type': 'text/html' } });

it('requires both exact owner markers in the logged-in menu, ignoring unrelated public profiles', () => {
  assert.doesNotThrow(() => assertHpoiPurchaseOwner(menu(), '1'));
  for (const html of [
    menu('2'),
    '<a href="/user/1">Public profile</a>',
    menu().replace('我的收藏', 'Other'),
    menu() + menu('2'),
  ])
    assert.throws(() => assertHpoiPurchaseOwner(html, '1'));
});

it('discovers internal IDs from real item links and cross-checks both fn.init namespaces', () => {
  assert.equal(parseHpoiPurchaseItemId(detail, '7'), '42');
  assert.throws(() => parseHpoiPurchaseItemId(detail.replace('fn, 42, 7', 'fn, 42, 8'), '7'));
  assert.throws(() => parseHpoiPurchaseItemId(detail.replace('itemId=42', 'itemId=99'), '7'));
  assert.throws(() => parseHpoiPurchaseItemId('<h1>Login</h1>', '7'));
});

it('reads only discovered item forms on the fixed origin without redirecting credentials or submitting edits', async () => {
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    assert.equal(url.origin, 'https://www.hpoi.net');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('cookie'), 'test-owner-session');
    if (url.pathname === '/user/home') return response(menu());
    if (url.pathname === '/hobby/7') return response(detail);
    assert.equal(url.pathname, '/collect/hobby/get/42');
    assert.equal(init?.method, 'POST');
    return response(form);
  };
  const source = createHpoiPurchaseSource('1', 'test-owner-session');
  const signal = AbortSignal.timeout(1_000);
  await source.verifyOwner(signal);
  const record = await source.read({ figureId: '7', title: 'Synthetic figure' }, signal);
  assert.equal(record.itemId, '42');
  assert.equal(record.figureId, '7');
  assert.equal(record.collectionId, '101');
  assert.ok(!JSON.stringify(record).includes('test-owner-session'));
  assert.deepEqual(calls, ['/user/home', '/hobby/7', '/collect/hobby/get/42']);
});

it('uses explicit owner pagination and rejects unverified/empty/captcha responses', async () => {
  let first = true;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/user/1/hobby');
    if (!first) {
      assert.equal(init?.method, 'POST');
      assert.equal(new URLSearchParams(String(init?.body)).get('page'), '2');
      return response(
        '<div class="collect-hobby-list-small"><div class="item"><a class="name" href="/hobby/8">Second</a></div></div>',
      );
    }
    first = false;
    assert.equal(url.searchParams.get('order'), 'actionDate');
    return response(
      `${menu()}<div class="hpoi-collect-container"><div class="collect-hobby-list-small"><div class="item"><a class="name" href="/hobby/7">First</a></div></div></div><script>const params={pageCount:2}</script>`,
    );
  };
  const source = createHpoiPurchaseSource('1', 'test-owner-session');
  const signal = AbortSignal.timeout(1_000);
  assert.equal((await source.discover(1, null, signal)).references[0].figureId, '7');
  assert.equal((await source.discover(2, 2, signal)).references[0].figureId, '8');
  globalThis.fetch = async () => response('<h1>Verification required</h1>');
  await assert.rejects(source.discover(1, null, signal));
  await assert.rejects(source.read({ figureId: '7', title: 'Test' }, signal));
  globalThis.fetch = async () =>
    response(`${menu()}<div class="hpoi-collect-container"></div><script>const params={pageCount:1}</script>`);
  await assert.rejects(source.discover(1, null, signal), /inconsistent/);
});
