import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import { createHpoiImageProxyUrl } from '@lib/hpoi/image';
import { stateColor } from '@lib/hpoi/releases';
import { lazy, Suspense, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { InlineSpinner } from '@/components/ui/InlineSpinner';
import type { TranslationKey } from '@/i18n/types';
import type { HpoiCollectionItem, HpoiCollectionState } from '@/types/hpoi';

const PurchaseDetail = lazy(() => import('./HpoiPurchaseDetail'));

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
  owner?: boolean;
  masonry?: boolean;
  ratingLoading?: boolean;
}

/** Keep the cover usable while optional rating enrichment is pending; settled empty scores display a dash. */
export function HpoiCard({ item, state, owner = false, masonry = false, ratingLoading = false }: HpoiCardProps) {
  const { t } = useTranslation();
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState(false);
  const source = item.imageUrl;
  const imageUrl = source && !failedImages.has(source) ? source : item.imageFallbackUrl;
  const visibleImage = imageUrl && !failedImages.has(imageUrl);
  const aspectRatio = masonry ? `${item.imageWidth ?? 360} / ${item.imageHeight ?? 520}` : '1 / 1';
  const crop = item.imageCrop;
  // Fit a poster's selected panel into the square grid too; CSS clips the full original,
  // so neither layout needs a downsampled or recompressed file.
  const panelScale = crop && !masonry ? Math.min(1, crop.width / crop.height) : 1;

  const card = (
    <a
      data-hpoi-category={state}
      style={state === 'all' ? undefined : { borderColor: stateColor[state] }}
      href={item.detailUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex min-w-0 flex-col overflow-hidden rounded-lg border-[3px] border-border bg-card transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      <div className="relative w-full overflow-hidden bg-muted/60" style={{ aspectRatio }}>
        {visibleImage ? (
          <img
            src={createHpoiImageProxyUrl(imageUrl)}
            onError={() => {
              setFailedImages((previous) => new Set([...previous, imageUrl]));
            }}
            alt={item.title}
            loading="lazy"
            decoding="async"
            style={
              crop
                ? {
                    position: 'absolute',
                    maxWidth: 'none',
                    width: `${(crop.sourceWidth / crop.width) * panelScale * 100}%`,
                    height: `${(crop.sourceHeight / (masonry ? crop.height : crop.width)) * panelScale * 100}%`,
                    left: `${((1 - panelScale) / 2 - (crop.left / crop.width) * panelScale) * 100}%`,
                    top: `${(masonry ? -crop.top / crop.height : (1 - (crop.height / crop.width) * panelScale) / 2 - (crop.top / crop.width) * panelScale) * 100}%`,
                  }
                : undefined
            }
            className="block size-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"
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
        <h2
          title={item.title}
          style={{ textWrap: 'wrap' }}
          className="max-w-full rounded-lg border border-white/20 bg-black/65 px-2.5 py-1.5 font-medium text-sm leading-5 shadow-sm backdrop-blur-sm"
        >
          <span className="block break-words">{item.title}</span>
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
  if (!owner) return card;
  return (
    <div className="min-w-0">
      {card}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="flex min-h-11 w-full items-center gap-2 px-2 text-left text-muted-foreground text-xs hover:text-foreground focus-visible:outline-primary"
      >
        <Icon icon="ri:receipt-line" aria-hidden="true" />
        {t('hpoi.purchaseDetails')}
        <Icon icon={expanded ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'} className="ml-auto" aria-hidden="true" />
      </button>
      {expanded && (
        <ErrorBoundary
          fallback={
            <p role="alert" className="rounded-lg bg-muted/40 p-3 text-sm">
              {t('hpoi.purchaseError')}{' '}
              <button type="button" onClick={() => window.location.reload()} className="min-h-11 underline underline-offset-4">
                {t('hpoi.purchaseReload')}
              </button>
            </p>
          }
        >
          <Suspense fallback={<InlineSpinner label={t('common.loading')} />}>
            <PurchaseDetail figureId={item.id} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}
