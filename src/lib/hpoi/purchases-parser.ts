import { load } from 'cheerio';
import { type HpoiPurchaseReference, hpoiPurchaseSchema, hpoiRecordId } from './purchases-schema';

/** Validate the requested internal item ID; the returned collection ID is a separate identity. */
export function parseHpoiPurchase(html: string, expected: HpoiPurchaseReference) {
  const $ = load(html);
  const id = $('input[type="hidden"][name="id"]');
  const itemId = $('input[type="hidden"][name="itemId"]');
  if (
    !expected.itemId ||
    id.length !== 1 ||
    itemId.length !== 1 ||
    !hpoiRecordId.safeParse(id.val()).success ||
    itemId.val() !== expected.itemId
  )
    throw new Error('Unexpected Hpoi collection identity.');

  function input(name: string) {
    const field = $(`input[name="${name}"], textarea[name="${name}"]`);
    if (field.length !== 1) throw new Error('Incomplete Hpoi purchase form.');
    const value = String(field.val() ?? '').trim();
    return value || null;
  }
  function select(name: string) {
    const field = $(`select[name="${name}"]`);
    if (field.length !== 1) throw new Error('Incomplete Hpoi purchase form.');
    const selected = field.find('option[selected]');
    // A browser defaults to the first option only when the server did not mark a selection.
    const option = selected.length ? selected : field.find('option').first();
    if (selected.length > 1 || option.length !== 1) throw new Error('Invalid Hpoi purchase selection.');
    return { value: option.attr('value')?.trim() || null, label: option.text().trim() || null };
  }
  const state = $('input[type="radio"][name="state"][checked]');
  if (state.length !== 1 || !state.attr('value')) throw new Error('Invalid Hpoi purchase state.');
  const currency = select('orderMoneyCurrency');
  const form = select('orderForm');
  const rawMoney = input('orderMoney');
  return hpoiPurchaseSchema.parse({
    ...expected,
    collectionId: id.val(),
    state: state.attr('value'),
    stateLabel: state.closest('label').text().trim(),
    orderTime: input('orderTime'),
    orderWay: input('orderWay'),
    orderMoney: rawMoney,
    orderMoneyCurrency: currency.value,
    currencyLabel: currency.label,
    orderForm: form.value,
    orderFormLabel: form.label,
    tags: input('tags'),
    comment: input('comment'),
  });
}
