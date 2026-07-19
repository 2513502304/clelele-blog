import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import { cn } from '@lib/utils';
import { useState } from 'react';
import { MAX_COLLECTION_PAGE_SIZE, MIN_COLLECTION_PAGE_SIZE } from '@/constants/pagination';

interface CollectionPaginationSettingsProps {
  isPaginated: boolean;
  pageSize: number;
  onModeChange: (isPaginated: boolean) => void;
  onPageSizeChange: (pageSize: number) => void;
}

/**
 * 分页模式和每页数量控件。
 * 编辑期间保留用户输入的原始文本，合法值即时生效；失焦时再夹紧越界数字，避免 UI 显示值与实际页大小不一致。
 */
export function CollectionPaginationSettings({
  isPaginated,
  pageSize,
  onModeChange,
  onPageSizeChange,
}: CollectionPaginationSettingsProps) {
  const { t } = useTranslation();
  const [pageSizeDraft, setPageSizeDraft] = useState('');
  const [isEditingPageSize, setIsEditingPageSize] = useState(false);
  const pageSizeInput = isEditingPageSize ? pageSizeDraft : String(pageSize);

  function handlePageSizeInput(value: string) {
    setPageSizeDraft(value);
    const parsedValue = Number.parseInt(value, 10);
    if (Number.isInteger(parsedValue) && parsedValue >= MIN_COLLECTION_PAGE_SIZE && parsedValue <= MAX_COLLECTION_PAGE_SIZE) {
      onPageSizeChange(parsedValue);
    }
  }

  function commitPageSizeInput() {
    setIsEditingPageSize(false);
    const parsedValue = Number.parseInt(pageSizeDraft, 10);
    if (!Number.isInteger(parsedValue)) return;

    const clampedValue = Math.min(MAX_COLLECTION_PAGE_SIZE, Math.max(MIN_COLLECTION_PAGE_SIZE, parsedValue));
    if (clampedValue !== pageSize) onPageSizeChange(clampedValue);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <fieldset className="inline-flex h-9 rounded-md border border-border p-0.5">
        <legend className="sr-only">{t('pagination.mode')}</legend>
        <button
          type="button"
          onClick={() => onModeChange(true)}
          aria-pressed={isPaginated}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-2.5 text-sm transition-colors',
            isPaginated ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon icon="ri:pages-line" className="size-4" />
          {t('pagination.paginated')}
        </button>
        <button
          type="button"
          onClick={() => onModeChange(false)}
          aria-pressed={!isPaginated}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-2.5 text-sm transition-colors',
            !isPaginated ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon icon="ri:list-check-3" className="size-4" />
          {t('pagination.showAll')}
        </button>
      </fieldset>

      {isPaginated && (
        <label className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-2.5 text-muted-foreground text-sm">
          <span>{t('pagination.perPage')}</span>
          <input
            type="number"
            min={MIN_COLLECTION_PAGE_SIZE}
            max={MAX_COLLECTION_PAGE_SIZE}
            step="1"
            inputMode="numeric"
            value={pageSizeInput}
            onFocus={() => {
              setPageSizeDraft(String(pageSize));
              setIsEditingPageSize(true);
            }}
            onChange={(event) => handlePageSizeInput(event.target.value)}
            onBlur={commitPageSizeInput}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            aria-label={t('pagination.perPage')}
            className="w-12 bg-transparent text-right text-foreground tabular-nums outline-none"
          />
        </label>
      )}
    </div>
  );
}

interface CollectionPaginatorProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/** 只展示首尾页和当前页附近页码，跳过的连续区间用省略号表示。 */
export function CollectionPaginator({ currentPage, totalPages, onPageChange }: CollectionPaginatorProps) {
  const { t } = useTranslation();

  if (totalPages <= 1) return null;

  const visiblePages = Array.from({ length: totalPages }, (_, index) => index + 1).filter((page) => {
    if (totalPages <= 7) return true;
    if (page === 1 || page === totalPages) return true;
    return Math.abs(page - currentPage) <= 2;
  });

  return (
    <nav className="flex items-center justify-center gap-2 pt-4" aria-label={t('pagination.navigation')}>
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1}
        aria-label={t('pagination.prev')}
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        <Icon icon="ri:arrow-left-s-line" className="size-4" />
      </button>
      <div className="flex gap-1">
        {visiblePages.map((page, index) => {
          const previousPage = visiblePages[index - 1];
          const showEllipsis = previousPage !== undefined && page - previousPage > 1;
          return (
            <span key={page} className="flex items-center">
              {showEllipsis && <span className="px-1 text-muted-foreground">...</span>}
              <button
                type="button"
                onClick={() => onPageChange(page)}
                aria-current={currentPage === page ? 'page' : undefined}
                aria-label={t('pagination.page', { page })}
                className={cn(
                  'min-w-8 rounded-md px-2 py-1.5 text-sm transition-colors',
                  currentPage === page
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80',
                )}
              >
                {page}
              </button>
            </span>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage === totalPages}
        aria-label={t('pagination.next')}
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        <Icon icon="ri:arrow-right-s-line" className="size-4" />
      </button>
    </nav>
  );
}
