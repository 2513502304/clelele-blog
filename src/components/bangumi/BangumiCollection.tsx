import { useBangumiData } from '@hooks/useBangumiData';
import { useCollectionPagination } from '@hooks/useCollectionPagination';
import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import { cn } from '@lib/utils';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useMemo, useState } from 'react';
import type { TranslationKey } from '@/i18n/types';
import { SUBJECT_TYPE_KEYS, type SubjectTypeKey } from '@/lib/bangumi/constants';
import { sortBangumiCollectionItems } from '@/lib/bangumi/sort';
import type { BangumiCollectionType, BangumiSortDirection, BangumiSortKey } from '@/types/bangumi';
import { CollectionPaginationSettings, CollectionPaginator } from '../collection/CollectionPagination';
import { BangumiCard } from './BangumiCard';

const TAB_LABEL_KEYS: Record<SubjectTypeKey, TranslationKey> = {
  anime: 'bangumi.anime',
  book: 'bangumi.book',
  music: 'bangumi.music',
  game: 'bangumi.game',
  real: 'bangumi.real',
};

const FILTER_OPTIONS: Array<{ key: BangumiCollectionType | 'all'; labelKey: TranslationKey }> = [
  { key: 'all', labelKey: 'bangumi.all' },
  { key: 2, labelKey: 'bangumi.collected' },
  { key: 3, labelKey: 'bangumi.watching' },
  { key: 1, labelKey: 'bangumi.wish' },
  { key: 4, labelKey: 'bangumi.onHold' },
  { key: 5, labelKey: 'bangumi.dropped' },
];

const SORT_OPTIONS: Array<{ key: BangumiSortKey; labelKey: TranslationKey }> = [
  { key: 'default', labelKey: 'bangumi.sortDefault' },
  { key: 'title', labelKey: 'bangumi.sortTitle' },
  { key: 'personalScore', labelKey: 'bangumi.sortPersonalScore' },
  { key: 'averageScore', labelKey: 'bangumi.sortAverageScore' },
  { key: 'date', labelKey: 'bangumi.sortDate' },
];

interface BangumiCollectionProps {
  userId: string;
}

export function BangumiCollection({ userId }: BangumiCollectionProps) {
  const { t } = useTranslation();
  const { data, isLoading, error, retry } = useBangumiData(userId);

  const [activeTab, setActiveTab] = useState<SubjectTypeKey>('anime');
  const [activeFilter, setActiveFilter] = useState<BangumiCollectionType | 'all'>('all');
  const [sortKey, setSortKey] = useState<BangumiSortKey>('default');
  const [sortDirection, setSortDirection] = useState<BangumiSortDirection>('asc');
  const shouldReduceMotion = useReducedMotion();

  const springTransition = shouldReduceMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 400, damping: 30 };

  const tabs = useMemo(() => {
    return SUBJECT_TYPE_KEYS.filter((key) => data[key].length > 0).map((key) => ({
      key,
      label: t(TAB_LABEL_KEYS[key]),
      count: data[key].length,
    }));
  }, [data, t]);

  const tabItems = data[activeTab];

  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = { all: tabItems.length };
    for (const item of tabItems) {
      counts[item.type] = (counts[item.type] ?? 0) + 1;
    }
    return counts;
  }, [tabItems]);

  const filteredItems = useMemo(() => {
    if (activeFilter === 'all') return tabItems;
    return tabItems.filter((item) => item.type === activeFilter);
  }, [tabItems, activeFilter]);

  const sortedItems = useMemo(
    () => sortBangumiCollectionItems(filteredItems, sortKey, sortDirection),
    [filteredItems, sortDirection, sortKey],
  );
  const { currentPage, isPaginated, pageSize, setCurrentPage, setIsPaginated, setPageSize, totalPages, visibleItems } =
    useCollectionPagination(sortedItems, 'bangumi-pagination-settings');

  function handleTabChange(key: SubjectTypeKey) {
    setActiveTab(key);
    setActiveFilter('all');
    setCurrentPage(1);
  }

  function handleFilterChange(key: BangumiCollectionType | 'all') {
    setActiveFilter(key);
    setCurrentPage(1);
  }

  function handleSortChange(key: BangumiSortKey) {
    setSortKey(key);
    setCurrentPage(1);
  }

  function toggleSortDirection() {
    setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    setCurrentPage(1);
  }

  if (isLoading) {
    return (
      <div className="space-y-4 py-8" aria-hidden="true">
        <div className="flex gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have no stable id
            <div key={i} className="h-8 w-16 animate-pulse rounded bg-muted" />
          ))}
        </div>
        <div className="grid desktop:grid-cols-4 grid-cols-3 gap-4 md:grid-cols-2">
          {Array.from({ length: 8 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have no stable id
            <div key={i} className="animate-pulse">
              <div className="aspect-[2/3] rounded-lg bg-muted" />
              <div className="mt-2 h-4 w-3/4 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 py-8">
        <p className="text-muted-foreground">{t('bangumi.error')}</p>
        <button
          type="button"
          onClick={retry}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm transition-colors hover:bg-primary/90"
        >
          {t('bangumi.retry')}
        </button>
      </div>
    );
  }

  if (tabs.length === 0) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center py-8">
        <p className="text-muted-foreground">{t('bangumi.noItems')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center gap-6 border-border border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleTabChange(tab.key)}
            className={cn(
              'relative flex items-center gap-1.5 pb-2.5 font-medium text-sm transition-colors',
              activeTab === tab.key ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            <span
              className={cn(
                'rounded-full px-1.5 text-xs tabular-nums',
                activeTab === tab.key ? 'text-primary' : 'text-muted-foreground/60',
              )}
            >
              {tab.count}
            </span>
            {activeTab === tab.key && (
              <motion.span
                layoutId="bangumi-tab-indicator"
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary"
                transition={springTransition}
              />
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTER_OPTIONS.map(
          ({ key, labelKey }) =>
            (key === 'all' || (filterCounts[key] ?? 0) > 0) && (
              <button
                key={key}
                type="button"
                onClick={() => handleFilterChange(key)}
                className={cn(
                  'rounded-full border px-3 py-1 font-medium text-xs transition-colors',
                  activeFilter === key
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-transparent bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {t(labelKey)}
                <span className="ml-1 tabular-nums opacity-60">({filterCounts[key] ?? 0})</span>
              </button>
            ),
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <CollectionPaginationSettings
          isPaginated={isPaginated}
          pageSize={pageSize}
          onModeChange={setIsPaginated}
          onPageSizeChange={setPageSize}
        />
        <div className="flex gap-2">
          <label htmlFor="bangumi-sort" className="sr-only">
            {t('bangumi.sortBy')}
          </label>
          <div className="relative">
            <Icon
              icon="ri:sort-alphabet-asc"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <select
              id="bangumi-sort"
              value={sortKey}
              onChange={(event) => handleSortChange(event.target.value as BangumiSortKey)}
              className="h-9 appearance-none rounded-md border border-border bg-background pr-8 pl-8 text-sm outline-none transition-colors hover:border-primary/40 focus:border-primary"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {t(option.labelKey)}
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
            title={sortDirection === 'asc' ? t('bangumi.sortAscending') : t('bangumi.sortDescending')}
            aria-label={sortDirection === 'asc' ? t('bangumi.sortAscending') : t('bangumi.sortDescending')}
            onClick={toggleSortDirection}
            className="flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Icon icon={sortDirection === 'asc' ? 'ri:sort-asc' : 'ri:sort-desc'} className="size-4" />
          </button>
        </div>
      </div>

      <AnimatePresence mode="popLayout">
        <motion.div
          key={`${activeTab}-${activeFilter}-${sortKey}-${sortDirection}-${isPaginated}-${currentPage}`}
          className="grid desktop:grid-cols-4 grid-cols-3 gap-3 md:grid-cols-2"
          initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {visibleItems.map((item) => (
            <BangumiCard key={item.subject_id} item={item} />
          ))}
        </motion.div>
      </AnimatePresence>

      {filteredItems.length === 0 && (
        <div className="flex min-h-[200px] items-center justify-center">
          <p className="text-muted-foreground">{t('bangumi.noItems')}</p>
        </div>
      )}

      {isPaginated && <CollectionPaginator currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />}

      <footer className="flex justify-end border-border border-t pt-3">
        <a
          href={`https://bgm.tv/user/${encodeURIComponent(userId)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-primary"
        >
          {t('bangumi.source')}
          <Icon icon="ri:external-link-line" className="size-3" />
        </a>
      </footer>
    </div>
  );
}
