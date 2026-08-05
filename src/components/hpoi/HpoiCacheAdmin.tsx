import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import { useEffect, useState } from 'react';
import type { TranslationKey } from '@/i18n/types';
import type { HpoiCollectionResponse, HpoiCollectionState } from '@/types/hpoi';
import { HPOI_COLLECTION_STATES } from '@/types/hpoi';

type RequestState = 'loading' | 'ready' | 'refreshing' | 'success' | 'error';

/** Owner 管理工具：展示当前公开快照，并通过受保护的 POST 接口刷新 Hpoi CDN 缓存。 */
export function HpoiCacheAdmin() {
  const { locale, t } = useTranslation();
  const [data, setData] = useState<HpoiCollectionResponse | null>(null);
  const [requestState, setRequestState] = useState<RequestState>('loading');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/hpoi', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Hpoi API returned HTTP ${response.status}.`);
        return response.json() as Promise<HpoiCollectionResponse>;
      })
      .then((responseData) => {
        setData(responseData);
        setRequestState('ready');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setRequestState('error');
      });
    return () => controller.abort();
  }, []);

  async function refreshCache() {
    setRequestState('refreshing');
    try {
      const response = await fetch('/api/hpoi/refresh', { method: 'POST' });
      if (!response.ok) throw new Error(`Hpoi refresh API returned HTTP ${response.status}.`);
      setData((await response.json()) as HpoiCollectionResponse);
      setRequestState('success');
    } catch {
      setRequestState('error');
    }
  }

  const fetchedAt = data
    ? new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(data.fetchedAt))
    : null;

  return (
    <section className="space-y-6 py-4">
      <header className="flex flex-wrap items-start justify-between gap-4 border-border border-b pb-5">
        <div className="space-y-1">
          <p className="font-medium text-primary text-sm">Owner only</p>
          <h1 className="font-semibold text-2xl">{t('hpoi.adminTitle')}</h1>
          <p className="text-muted-foreground text-sm">{t('hpoi.adminDescription')}</p>
        </div>
        <button
          type="button"
          onClick={refreshCache}
          disabled={requestState === 'loading' || requestState === 'refreshing'}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon icon="ri:refresh-line" className={requestState === 'refreshing' ? 'size-4 animate-spin' : 'size-4'} />
          {requestState === 'refreshing' ? t('hpoi.adminRefreshing') : t('hpoi.adminRefresh')}
        </button>
      </header>

      {requestState === 'error' && (
        <p className="flex items-center gap-2 text-red-600 text-sm dark:text-red-400" role="alert">
          <Icon icon="ri:error-warning-line" className="size-4 shrink-0" />
          {t('hpoi.adminError')}
        </p>
      )}
      {requestState === 'success' && (
        <output className="flex items-center gap-2 text-emerald-600 text-sm dark:text-emerald-400">
          <Icon icon="ri:checkbox-circle-line" className="size-4 shrink-0" />
          {t('hpoi.adminSuccess')}
        </output>
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-base">{t('hpoi.adminSnapshot')}</h2>
          <span className="text-muted-foreground text-xs">
            {fetchedAt ? t('hpoi.updatedAt', { time: fetchedAt }) : t('hpoi.adminLoading')}
          </span>
        </div>
        <dl className="grid grid-cols-3 border-border border-y md:grid-cols-2">
          {HPOI_COLLECTION_STATES.map((state) => (
            <div key={state} className="border-border border-r px-3 py-4 last:border-r-0">
              <dt className="text-muted-foreground text-xs">{t(STATE_LABELS[state])}</dt>
              <dd className="mt-1 font-semibold text-lg tabular-nums">{data?.collections[state].length ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

const STATE_LABELS: Record<HpoiCollectionState, TranslationKey> = {
  all: 'hpoi.all',
  care: 'hpoi.care',
  want: 'hpoi.want',
  preorder: 'hpoi.preorder',
  buy: 'hpoi.buy',
  resell: 'hpoi.resell',
};
