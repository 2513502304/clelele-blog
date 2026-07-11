import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import { createHpoiImageProxyUrl } from '@lib/hpoi/image';
import { sortHpoiCollectionItems } from '@lib/hpoi/sort';
import { cn } from '@lib/utils';
import { useEffect, useMemo, useState } from 'react';
import type { TranslationKey } from '@/i18n/types';
import type {
  HpoiCollectionResponse,
  HpoiCollectionState,
  HpoiProfileStats,
  HpoiSortDirection,
  HpoiSortKey,
} from '@/types/hpoi';
import { HPOI_COLLECTION_STATES } from '@/types/hpoi';
import { HpoiCard } from './HpoiCard';

const STATE_LABELS: Record<HpoiCollectionState, TranslationKey> = {
  all: 'hpoi.all',
  care: 'hpoi.care',
  want: 'hpoi.want',
  preorder: 'hpoi.preorder',
  buy: 'hpoi.buy',
  resell: 'hpoi.resell',
};

const PROFILE_STATS: Array<{ field: keyof HpoiProfileStats; label: TranslationKey; icon: string }> = [
  { field: 'owned', label: 'hpoi.owned', icon: 'ri:archive-stack-line' },
  { field: 'totalSpent', label: 'hpoi.totalSpent', icon: 'ri:wallet-3-line' },
  { field: 'amazonChange', label: 'hpoi.amazonChange', icon: 'ri:line-chart-line' },
  { field: 'wanted', label: 'hpoi.wanted', icon: 'ri:heart-3-line' },
  { field: 'preordered', label: 'hpoi.preordered', icon: 'ri:calendar-check-line' },
  { field: 'pendingPayment', label: 'hpoi.pendingPayment', icon: 'ri:bank-card-line' },
];

const SORT_OPTIONS: Array<{ key: HpoiSortKey; label: TranslationKey }> = [
  { key: 'default', label: 'hpoi.sortDefault' },
  { key: 'id', label: 'hpoi.sortId' },
  { key: 'title', label: 'hpoi.sortTitle' },
  { key: 'score', label: 'hpoi.sortScore' },
  { key: 'releaseDate', label: 'hpoi.sortReleaseDate' },
];

export function HpoiCollection() {
  const { t, locale } = useTranslation();
  const [data, setData] = useState<HpoiCollectionResponse | null>(null);
  const [error, setError] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const [activeState, setActiveState] = useState<HpoiCollectionState>('all');
  const [sortKey, setSortKey] = useState<HpoiSortKey>('default');
  const [sortDirection, setSortDirection] = useState<HpoiSortDirection>('asc');

  useEffect(() => {
    const controller = new AbortController();
    setError(false);

    const requestUrl = requestVersion === 0 ? '/api/hpoi' : `/api/hpoi?retry=${requestVersion}`;
    fetch(requestUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Hpoi API returned HTTP ${response.status}.`);
        return response.json() as Promise<HpoiCollectionResponse>;
      })
      .then(setData)
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setError(true);
      });

    return () => controller.abort();
  }, [requestVersion]);

  const activeItems = useMemo(
    () => (data ? sortHpoiCollectionItems(data.collections[activeState], sortKey, sortDirection) : []),
    [activeState, data, sortDirection, sortKey],
  );

  if (!data && !error) return <HpoiCollectionSkeleton />;

  if (!data && error) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center gap-4 py-10 text-center">
        <Icon icon="ri:cloud-off-line" className="size-8 text-muted-foreground" />
        <p className="text-muted-foreground text-sm">{t('hpoi.error')}</p>
        <button
          type="button"
          onClick={() => setRequestVersion((version) => version + 1)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
        >
          <Icon icon="ri:refresh-line" className="size-4" />
          {t('hpoi.retry')}
        </button>
      </div>
    );
  }

  if (!data) return null;

  const updatedAt = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(data.fetchedAt));

  return (
    <div className="space-y-6 py-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <a
          href={data.profile.profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex min-w-0 items-center gap-3"
        >
          {data.profile.avatarUrl ? (
            <img
              src={createHpoiImageProxyUrl(data.profile.avatarUrl)}
              alt=""
              className="size-12 shrink-0 rounded-full border border-border object-cover"
            />
          ) : (
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Icon icon="ri:user-line" className="size-5" />
            </span>
          )}
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 font-semibold transition-colors group-hover:text-primary">
              {data.profile.name}
              <Icon icon="ri:external-link-line" className="size-3.5 opacity-50" />
            </span>
            {data.profile.signature && (
              <span className="mt-0.5 block truncate text-muted-foreground text-sm">{data.profile.signature}</span>
            )}
          </span>
        </a>
        <span className="text-muted-foreground text-xs">{t('hpoi.updatedAt', { time: updatedAt })}</span>
      </header>

      <dl className="grid desktop:grid-cols-6 grid-cols-3 border-border border-y md:grid-cols-2">
        {PROFILE_STATS.map((stat) => (
          <div key={stat.field} className="flex min-w-0 items-center gap-2.5 border-border border-r px-3 py-3 last:border-r-0">
            <Icon icon={stat.icon} className="size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <dt className="truncate text-muted-foreground text-xs">{t(stat.label)}</dt>
              <dd className="truncate font-semibold text-sm tabular-nums">{data.profile.stats[stat.field] ?? '—'}</dd>
            </div>
          </div>
        ))}
      </dl>

      {data.warnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-800 text-sm dark:text-amber-300">
          <Icon icon="ri:error-warning-line" className="mt-0.5 size-4 shrink-0" />
          <span>{t('hpoi.partialWarning')}</span>
        </div>
      )}

      <div className="overflow-x-auto border-border border-b" role="tablist" aria-label={t('hpoi.title')}>
        <div className="flex min-w-max items-center gap-6">
          {HPOI_COLLECTION_STATES.map((state) => (
            <button
              key={state}
              type="button"
              role="tab"
              aria-selected={activeState === state}
              onClick={() => setActiveState(state)}
              className={cn(
                'relative flex items-center gap-1.5 pb-2.5 font-medium text-sm transition-colors',
                activeState === state ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(STATE_LABELS[state])}
              <span className="text-xs tabular-nums opacity-60">{data.collections[state].length}</span>
              {activeState === state && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <label htmlFor="hpoi-sort" className="sr-only">
          {t('hpoi.sortBy')}
        </label>
        <div className="relative">
          <Icon
            icon="ri:sort-alphabet-asc"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <select
            id="hpoi-sort"
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as HpoiSortKey)}
            className="h-9 appearance-none rounded-md border border-border bg-background pr-8 pl-8 text-sm outline-none transition-colors hover:border-primary/40 focus:border-primary"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {t(option.label)}
              </option>
            ))}
          </select>
          <Icon
            icon="ri:arrow-down-s-line"
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
          />
        </div>
        <button
          type="button"
          title={sortDirection === 'asc' ? t('hpoi.sortAscending') : t('hpoi.sortDescending')}
          aria-label={sortDirection === 'asc' ? t('hpoi.sortAscending') : t('hpoi.sortDescending')}
          onClick={() => setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'))}
          className="flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Icon icon={sortDirection === 'asc' ? 'ri:sort-asc' : 'ri:sort-desc'} className="size-4" />
        </button>
      </div>

      {activeItems.length > 0 ? (
        <div className="grid desktop:grid-cols-4 grid-cols-3 gap-3 md:grid-cols-2">
          {activeItems.map((item) => (
            <HpoiCard key={item.id} item={item} state={activeState} />
          ))}
        </div>
      ) : (
        <div className="flex min-h-52 flex-col items-center justify-center gap-2 text-muted-foreground">
          <Icon icon="ri:archive-drawer-line" className="size-7 opacity-60" />
          <p className="text-sm">{t('hpoi.noItems')}</p>
        </div>
      )}

      <footer className="flex justify-end border-border border-t pt-3">
        <a
          href={data.profile.profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-primary"
        >
          {t('hpoi.source')}
          <Icon icon="ri:external-link-line" className="size-3" />
        </a>
      </footer>
    </div>
  );
}

function HpoiCollectionSkeleton() {
  return (
    <div className="space-y-6 py-4" aria-hidden="true">
      <div className="flex items-center gap-3">
        <div className="size-12 animate-pulse rounded-full bg-muted" />
        <div className="space-y-2">
          <div className="h-4 w-28 animate-pulse rounded bg-muted" />
          <div className="h-3 w-44 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="grid desktop:grid-cols-6 grid-cols-3 gap-px border-border border-y md:grid-cols-2">
        {PROFILE_STATS.map((stat) => (
          <div key={stat.field} className="h-16 animate-pulse bg-muted/70" />
        ))}
      </div>
      <div className="grid desktop:grid-cols-4 grid-cols-3 gap-3 md:grid-cols-2">
        {Array.from({ length: 8 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed skeleton placeholders have no domain identifier
          <div key={index} className="overflow-hidden rounded-lg border border-border">
            <div className="aspect-square animate-pulse bg-muted" />
            <div className="space-y-2 p-3">
              <div className="h-4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
