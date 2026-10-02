import { useProgressiveCollection } from '@hooks/useProgressiveCollection';
import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import { cn } from '@lib/utils';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo, useState } from 'react';
import type { TranslationKey } from '@/i18n/types';
import { SUBJECT_TYPE_KEYS, type SubjectTypeKey } from '@/lib/bangumi/constants';
import { sortBangumiCollectionItems } from '@/lib/bangumi/sort';
import type { BangumiCollectionType, BangumiSortDirection, BangumiSortKey, BangumiUserCollection } from '@/types/bangumi';
import { CollectionLoadMore } from '../collection/CollectionLoadMore';
import StyleGalleryGrid, { StyleGalleryLayoutToggle } from '../style-gallery/StyleGalleryGrid';
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

/** Load the active subject on demand; filtering and sorting require its complete collection. */
export function BangumiCollection({ userId }: BangumiCollectionProps) {
  const { t, locale } = useTranslation();

  const [activeTab, setActiveTab] = useState<SubjectTypeKey>('anime');
  const [activeFilter, setActiveFilter] = useState<BangumiCollectionType | 'all'>('all');
  const [sortKey, setSortKey] = useState<BangumiSortKey>('default');
  const [sortDirection, setSortDirection] = useState<BangumiSortDirection>('asc');
  const shouldReduceMotion = useReducedMotion();

  const springTransition = shouldReduceMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 400, damping: 30 };

  const [masonry, setMasonry] = useState(true);
  const collection = useProgressiveCollection<BangumiUserCollection, Record<string, never>>(
    `/api/bangumi?subject=${activeTab}&offset=0`,
    (item) => item.subject_id,
    activeFilter !== 'all' || sortKey !== 'default' || sortDirection !== 'asc',
  );
  const { error, loadMore: retry } = collection;
  const waitingForComplete =
    (activeFilter !== 'all' || sortKey !== 'default' || sortDirection !== 'asc') && !collection.complete;
  const tabs = SUBJECT_TYPE_KEYS.map((key) => ({
    key,
    label: t(TAB_LABEL_KEYS[key]),
    count: key === activeTab ? collection.total : undefined,
  }));
  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = { all: collection.items.length };
    for (const item of collection.items) counts[item.type] = (counts[item.type] ?? 0) + 1;
    return counts;
  }, [collection.items]);
  const filteredItems = useMemo(
    () => (activeFilter === 'all' ? collection.items : collection.items.filter((item) => item.type === activeFilter)),
    [collection.items, activeFilter],
  );
  const sortedItems = useMemo(
    () => sortBangumiCollectionItems(filteredItems, sortKey, sortDirection),
    [filteredItems, sortKey, sortDirection],
  );
  const [visibleCount, setVisibleCount] = useState(24);
  const visibleItems = waitingForComplete ? [] : sortedItems.slice(0, visibleCount);
  const loadMore = () => (sortedItems.length > visibleCount ? setVisibleCount((n) => n + 24) : collection.loadMore());

  function handleTabChange(key: SubjectTypeKey) {
    setActiveTab(key);
    setActiveFilter('all');
    setVisibleCount(24);
  }

  function handleFilterChange(key: BangumiCollectionType | 'all') {
    setActiveFilter(key);
    setVisibleCount(24);
  }

  function handleSortChange(key: BangumiSortKey) {
    setSortKey(key);
    setVisibleCount(24);
  }

  function toggleSortDirection() {
    setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    setVisibleCount(24);
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
            (!collection.complete || key === 'all' || (filterCounts[key] ?? 0) > 0) && (
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
                {collection.complete && <span className="ml-1 tabular-nums opacity-60">({filterCounts[key] ?? 0})</span>}
              </button>
            ),
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <StyleGalleryLayoutToggle masonry={masonry} onChange={() => setMasonry((value) => !value)} locale={locale} />
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

      {waitingForComplete && (
        <output className="text-muted-foreground text-sm">
          {locale.startsWith('zh')
            ? '正在读取当前分类，以完成完整筛选与排序…'
            : locale.startsWith('ja')
              ? '絞り込みと並べ替えのために読み込み中…'
              : 'Loading this category for complete filtering and sorting…'}
        </output>
      )}
      <StyleGalleryGrid masonry={masonry}>
        {visibleItems.map((item) => (
          <BangumiCard key={item.subject_id} item={item} />
        ))}
      </StyleGalleryGrid>
      {collection.complete && filteredItems.length === 0 && (
        <p className="py-8 text-center text-muted-foreground">{t('bangumi.noItems')}</p>
      )}
      <CollectionLoadMore
        more={!collection.complete || visibleCount < sortedItems.length}
        loading={collection.loading}
        error={error}
        onLoad={error ? retry : loadMore}
        locale={locale}
      />

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
