import { Icon } from '@iconify/react';
import { cn } from '@lib/utils';

/** Explicit, keyboard-accessible exit from filtered results to the card's full-list neighborhood. */
export default function GalleryLocateButton({
  locale,
  title,
  onLocate,
  compact = false,
  className,
}: {
  locale: string;
  title: string;
  onLocate: () => void;
  compact?: boolean;
  className?: string;
}) {
  const zh = locale.startsWith('zh');
  const ja = locale.startsWith('ja');
  const label = zh ? '查看原始位置' : ja ? '元の位置を表示' : 'Show original position';
  const help = zh
    ? '清除筛选，定位到完整列表中的这张卡片；保留当前排序和布局。'
    : ja
      ? '絞り込みを解除し、一覧の元の位置へ移動します。並び順とレイアウトは維持します。'
      : 'Clear filters and locate this card in the full list, keeping the current sort and layout.';
  return (
    <button
      type="button"
      onClick={onLocate}
      aria-label={`${label}: ${title}`}
      title={`${label} — ${help}`}
      className={cn(
        'glass-image-action absolute z-10 flex items-center justify-center text-white transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
        compact ? 'size-6 rounded-sm' : 'size-9 rounded-lg',
        className,
      )}
    >
      <Icon icon="ri:focus-3-line" className={compact ? 'size-3.5' : 'size-4'} />
    </button>
  );
}
