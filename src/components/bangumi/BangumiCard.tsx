import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import { cn } from '@lib/utils';
import type { TranslationKey } from '@/i18n/types';
import { COLLECTION_STATUS_COLORS } from '@/lib/bangumi/constants';
import type { BangumiCollectionType, BangumiUserCollection } from '@/types/bangumi';

const COLLECTION_LABEL_KEYS: Record<BangumiCollectionType, TranslationKey> = {
  1: 'bangumi.wish',
  2: 'bangumi.collected',
  3: 'bangumi.watching',
  4: 'bangumi.onHold',
  5: 'bangumi.dropped',
};

interface BangumiCardProps {
  item: BangumiUserCollection;
}

/** 展示 fork 新增的个人评分、站点评分、放送信息和收藏统计，并保留 Bangumi 详情页入口。 */
export function BangumiCard({ item }: BangumiCardProps) {
  const { t, locale } = useTranslation();
  const { subject } = item;
  const title = subject.name_cn || subject.name;
  // 用户为收藏设置的标签更能表达个人分类；未设置时才回退到条目的公共标签。
  const tags = item.tags.length > 0 ? item.tags : (subject.tags?.map((tag) => tag.name) ?? []);
  const displayTags = tags.slice(0, 3);
  const overflowCount = tags.length - displayTags.length;
  const imageUrl = subject.images?.common || subject.images?.medium;

  const personalScore = item.rate > 0 ? item.rate : null;
  const averageScore = subject.score > 0 ? subject.score : null;
  const episodeCount = subject.eps && subject.eps > 0 ? subject.eps : null;
  const volumeCount = subject.volumes && subject.volumes > 0 ? subject.volumes : null;
  const collectionTotal =
    subject.collection_total === undefined
      ? '—'
      : new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(subject.collection_total);
  const rank = subject.rank && subject.rank > 0 ? subject.rank : null;

  return (
    <a
      href={`https://bgm.tv/subject/${subject.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex flex-col overflow-hidden rounded-lg shadow-md transition-transform duration-200 hover:scale-[1.02] hover:shadow-lg"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-muted">
        {imageUrl ? (
          <img src={imageUrl} alt={title} loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground text-sm">{t('bangumi.noImage')}</div>
        )}

        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 to-transparent" />

        <span
          className={cn(
            'absolute top-2 left-2 rounded px-1.5 py-0.5 font-medium text-white text-xs',
            COLLECTION_STATUS_COLORS[item.type],
          )}
        >
          {t(COLLECTION_LABEL_KEYS[item.type])}
        </span>

        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <h3 className="line-clamp-2 font-medium text-sm text-white leading-tight drop-shadow-md">{title}</h3>
        </div>
      </div>

      <div className="flex min-h-40 flex-1 flex-col gap-2 bg-card p-2.5">
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <span className="rounded bg-amber-50 px-1.5 py-1 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <span className="block text-[10px] opacity-70">{t('bangumi.personalScore')}</span>
            <span className="font-semibold">★ {personalScore ?? '—'}</span>
          </span>
          <span className="rounded bg-muted px-1.5 py-1 text-foreground">
            <span className="block text-[10px] text-muted-foreground">{t('bangumi.averageScore')}</span>
            <span className="font-semibold">★ {averageScore ?? '—'}</span>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-muted-foreground md:text-[10px]">
          <span className="flex min-w-0 items-center gap-1" title={subject.date ?? undefined}>
            <Icon icon="ri:calendar-event-line" className="size-3.5 shrink-0" />
            <span className="truncate">{subject.date ?? '—'}</span>
          </span>
          {episodeCount !== null ? (
            <span className="flex items-center gap-1">
              <Icon icon="ri:movie-2-line" className="size-3.5 shrink-0" />
              {t('bangumi.episodeCount', { count: episodeCount })}
            </span>
          ) : volumeCount !== null ? (
            <span className="flex items-center gap-1">
              <Icon icon="ri:book-2-line" className="size-3.5 shrink-0" />
              {t('bangumi.volumeCount', { count: volumeCount })}
            </span>
          ) : null}
          <span className="flex items-center gap-1" title={t('bangumi.rank', { rank: rank ?? '—' })}>
            <Icon icon="ri:bar-chart-box-line" className="size-3.5 shrink-0" />
            {rank === null ? '—' : `#${rank}`}
          </span>
          <span className="flex items-center gap-1" title={t('bangumi.collectionTotal', { count: collectionTotal })}>
            <Icon icon="ri:group-line" className="size-3.5 shrink-0" />
            {collectionTotal}
          </span>
          <span className="col-span-2 flex items-center justify-between gap-2 border-border border-t pt-1">
            <span className="flex min-w-0 items-center gap-1">
              <Icon icon="ri:hashtag" className="size-3.5 shrink-0" />
              <span className="truncate">Bangumi {subject.id}</span>
            </span>
            <Icon icon="ri:external-link-line" className="size-3.5 shrink-0 opacity-60" />
          </span>
        </div>

        {displayTags.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1">
            {displayTags.map((tag) => (
              <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
                {tag}
              </span>
            ))}
            {overflowCount > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">+{overflowCount}</span>
            )}
          </div>
        )}
      </div>
    </a>
  );
}
