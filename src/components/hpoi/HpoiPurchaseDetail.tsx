import { useTranslation } from '@hooks/useTranslation';
import { useEffect, useState } from 'react';
import { InlineSpinner } from '@/components/ui/InlineSpinner';
import type { HpoiPurchase } from '@/lib/hpoi/purchases-schema';

/** Fetch only the expanded figure. Closing the card releases all purchase fields from component state. */
export default function HpoiPurchaseDetail({ figureId }: { figureId: string }) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<HpoiPurchase[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a manual retry must rerun the same figure read.
  useEffect(() => {
    const request = new AbortController();
    setError(false);
    setRecords(null);
    async function read() {
      const response = await fetch(`/api/hpoi/purchases?figureId=${encodeURIComponent(figureId)}`, {
        cache: 'no-store',
        signal: request.signal,
      });
      if (!response.ok) throw new Error('Purchase unavailable');
      const data = await response.json();
      if (!request.signal.aborted) setRecords(data.records);
    }
    void read().catch(() => {
      if (!request.signal.aborted) setError(true);
    });
    return () => request.abort();
  }, [figureId, attempt]);
  return (
    <section
      aria-label={t('hpoi.purchaseDetails')}
      className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-xs"
    >
      {error ? (
        <p role="alert">
          {t('hpoi.purchaseError')}{' '}
          <button
            type="button"
            className="min-h-11 rounded px-2 font-medium underline underline-offset-4"
            onClick={() => setAttempt(attempt + 1)}
          >
            {t('hpoi.purchaseRetry')}
          </button>
        </p>
      ) : records === null ? (
        <InlineSpinner label={t('common.loading')} />
      ) : records.length === 0 ? (
        <p className="text-muted-foreground">{t('hpoi.purchaseEmpty')}</p>
      ) : (
        records.map((record) => (
          <dl key={record.collectionId} className="space-y-2.5">
            {(
              [
                [
                  'hpoi.purchaseAmount',
                  record.orderMoney === null
                    ? null
                    : [record.orderMoney, record.currencyLabel || record.orderMoneyCurrency].filter(Boolean).join(' '),
                ],
                ['hpoi.purchaseDate', record.orderTime],
                ['hpoi.purchaseChannel', record.orderWay],
                ['hpoi.purchaseForm', record.orderFormLabel || record.orderForm],
                ['hpoi.purchaseNotes', [record.tags, record.comment].filter(Boolean).join('\n')],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex flex-wrap justify-between gap-x-2 gap-y-1">
                <dt className="text-muted-foreground">{t(label)}</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words text-end font-medium tabular-nums [overflow-wrap:anywhere]">
                  {value || t('hpoi.purchaseMissing')}
                </dd>
              </div>
            ))}
          </dl>
        ))
      )}
    </section>
  );
}
