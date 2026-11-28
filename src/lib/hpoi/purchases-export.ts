import type { HpoiPurchase } from './purchases-schema';

/** Currency codes are authoritative. A label alone stays a distinct group when the source omits its code. */
export function purchaseCurrency(record: HpoiPurchase) {
  return record.orderMoneyCurrency
    ? `code:${record.orderMoneyCurrency}`
    : record.currencyLabel
      ? `label:${record.currencyLabel}`
      : 'unknown';
}

export function selectPurchases(records: HpoiPurchase[], currency: string, missingOnly: boolean) {
  return records.filter(
    (record) => (!currency || purchaseCurrency(record) === currency) && (!missingOnly || record.orderMoney === null),
  );
}

/** Quote every cell, preserving commas and newlines and keeping user-supplied spreadsheet formulas inert. */
export function purchaseCsv(records: HpoiPurchase[]) {
  const quoteCell = (value: string | null) => {
    const raw = value ?? '';
    const text = /^\s*[=+@-]|^[\t\r\n]/.test(raw) ? `'${raw}` : raw;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [
    ['Hpoi ID', '商品', '状态', '入手日期', '购买渠道', '金额', '币种代码', '币种', '购买方式', '标签', '备注'],
    ...records.map((r) => [
      r.figureId,
      r.title,
      r.stateLabel || r.state,
      r.orderTime,
      r.orderWay,
      r.orderMoney,
      r.orderMoneyCurrency,
      r.currencyLabel,
      r.orderFormLabel || r.orderForm,
      r.tags,
      r.comment,
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(quoteCell).join(',')).join('\r\n')}\r\n`;
}
