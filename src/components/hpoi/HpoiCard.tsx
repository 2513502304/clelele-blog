import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import { createHpoiImageProxyUrl } from '@lib/hpoi/image';
import { useState } from 'react';
import { InlineSpinner } from '@/components/ui/InlineSpinner';
import type { TranslationKey } from '@/i18n/types';
import type { HpoiCollectionItem, HpoiCollectionState } from '@/types/hpoi';

const STATE_LABELS: Record<HpoiCollectionState, TranslationKey> = {
  all: 'hpoi.all',
  care: 'hpoi.care',
  want: 'hpoi.want',
  preorder: 'hpoi.preorder',
  buy: 'hpoi.buy',
  resell: 'hpoi.resell',
};

interface HpoiCardProps {
  item: HpoiCollectionItem;
  state: HpoiCollectionState;
  masonry?: boolean;
  ratingLoading?: boolean;
  detailImage?: string | null;
}

/** Keep the cover usable while optional rating enrichment is pending; settled empty scores display a dash. */
export function HpoiCard({ item, state, masonry = false, ratingLoading = false, detailImage }: HpoiCardProps) {
  const { t } = useTranslation();
  const [failedImage, setFailedImage] = useState<string>();
  const imageUrl = detailImage && failedImage !== detailImage ? detailImage : item.imageUrl;

  return (
    <a
      href={item.detailUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      <div className={`relative w-full overflow-hidden bg-muted/60 ${masonry && imageUrl ? '' : 'aspect-square'}`}>
        {imageUrl ? (
          <img
            src={createHpoiImageProxyUrl(imageUrl)}
            onError={() => {
              if (detailImage) setFailedImage(detailImage);
            }}
            alt={item.title}
            loading="lazy"
            decoding="async"
            style={masonry ? { aspectRatio: 'auto 1 / 1' } : undefined}
            className={
              masonry
                ? 'block h-auto w-full'
                : 'size-full object-contain transition-transform duration-300 group-hover:scale-[1.03]'
            }
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground text-xs">
            <Icon icon="ri:image-line" className="size-6" />
            {t('hpoi.noImage')}
          </div>
        )}

        {state !== 'all' && (
          <span className="absolute top-2 left-2 rounded bg-black/70 px-2 py-1 font-medium text-white text-xs backdrop-blur-sm">
            {t(STATE_LABELS[state])}
          </span>
        )}
        <span
          data-hpoi-rating
          aria-busy={ratingLoading}
          className="absolute top-2 right-2 flex min-w-12 items-center justify-center gap-1 rounded bg-black/70 px-2 py-1 font-medium text-amber-300 text-xs backdrop-blur-sm"
        >
          <Icon icon="ri:star-fill" className="size-3" />
          {ratingLoading ? <InlineSpinner label={t('common.loading')} /> : (item.score ?? '—')}
        </span>
      </div>

      <div className="absolute inset-x-2 bottom-2 flex flex-col items-start gap-1.5 text-white">
        <h2 className="max-w-full rounded-lg border border-white/20 bg-black/65 px-2.5 py-1.5 font-medium text-sm leading-5 shadow-sm backdrop-blur-sm">
          <span className="line-clamp-2">{item.title}</span>
        </h2>
        <div className="flex max-w-full flex-wrap gap-1.5 text-xs">
          <span
            title={item.releaseText ?? undefined}
            className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/70 px-2 py-1 backdrop-blur-sm"
          >
            <Icon icon="ri:calendar-event-line" className="size-3 shrink-0" />
            {item.releaseDate ?? item.releaseText ?? '—'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/70 px-2 py-1 backdrop-blur-sm">
            Hpoi {item.id}
            <Icon icon="ri:external-link-line" className="size-3 shrink-0 opacity-70" />
          </span>
        </div>
      </div>
    </a>
  );
}
