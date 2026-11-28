import assert from 'node:assert/strict';
import { it } from 'node:test';
import { parseHpoiPurchase } from './purchases-parser';

const reference = { itemId: '42', figureId: '7', title: '测试手办' };
const form = (money = '') => `<form>
  <input type="hidden" name="id" value="101"><input type="hidden" name="itemId" value="42">
  <label><input type="radio" name="state" value="buy" checked>已入</label>
  <input name="orderTime" value="2026-01-02"><input name="orderWay" value="测试店铺">
  <input type="number" name="orderMoney" value="${money}">
  <select name="orderMoneyCurrency"><option value="JPY">日元</option><option value="CNY" selected>人民币</option></select>
  <select name="orderForm"><option value="new" selected>全新</option></select>
  <input name="tags" value=""><textarea name="comment"></textarea>
</form>`;

it('retains decimal precision, selected currency, and unknown amounts without inventing zero', () => {
  const unknown = parseHpoiPurchase(form(), reference);
  assert.equal(unknown.orderMoney, null);
  assert.equal(unknown.comment, null);
  assert.equal(unknown.orderMoneyCurrency, 'CNY');
  assert.equal(unknown.currencyLabel, '人民币');
  assert.equal(unknown.stateLabel, '已入');
  assert.equal(parseHpoiPurchase(form('0'), reference).orderMoney, '0');
  assert.equal(parseHpoiPurchase(form('123.4500'), reference).orderMoney, '123.4500');
});

it('rejects login/block pages, truncated forms, invalid amounts and identity mismatches', () => {
  for (const html of [
    '<h1>Login</h1>',
    form().replace('name="orderWay"', 'name="missing"'),
    form().replace('value="101"', 'value=""'),
    form().replace('value="42"', 'value="43"'),
    form('NaN'),
    form('-10'),
    form().replace(' checked', ''),
  ])
    assert.throws(() => parseHpoiPurchase(html, reference));
});
