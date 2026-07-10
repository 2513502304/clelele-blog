import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import { createHpoiImageProxyUrl } from '@lib/hpoi/image';
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
}

export function HpoiCard({ item, state }: HpoiCardProps) {
  const { t } = useTranslation();

  return (
    <a
      href={item.detailUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted/60">
        {item.imageUrl ? (
          <img
            src={createHpoiImageProxyUrl(item.imageUrl)}
            alt={item.title}
            loading="lazy"
            className="size-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"
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
        {item.score && (
          <span className="absolute top-2 right-2 flex items-center gap-1 rounded bg-black/70 px-2 py-1 font-medium text-amber-300 text-xs backdrop-blur-sm">
            <Icon icon="ri:star-fill" className="size-3" />
            {item.score}
          </span>
        )}
      </div>

      <div className="flex min-h-20 flex-1 flex-col justify-between gap-2 p-3">
        <h2 className="line-clamp-2 font-medium text-sm leading-5 transition-colors group-hover:text-primary">{item.title}</h2>
        <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
          <span className="line-clamp-1">{item.releaseText ?? `Hpoi #${item.id}`}</span>
          <Icon icon="ri:external-link-line" className="size-3.5 shrink-0 opacity-60" />
        </div>
      </div>
    </a>
  );
}
