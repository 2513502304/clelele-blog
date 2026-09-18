import { useGalleryMarquee } from '@hooks/useGalleryMarquee';
import { Icon } from '@iconify/react';
import { getStyleGallerySourceThumbnail } from '@lib/style-gallery-image-key';
import { guardGalleryNavigation } from '@lib/style-gallery-navigation-guard';
import { $galleryTagEditor } from '@store/gallery-tags';
import { useEffect, useMemo, useState } from 'react';
import GallerySelectionDock from './GallerySelectionDock';
import StyleGalleryMerge from './StyleGalleryMerge';

/** Selection covers all filtered source IDs, including cards not yet progressively mounted. */
export function useGalleryTagSelection(
  slugs: string[],
  locale: string,
  pending = false,
  mergeItems: { slug: string; imageHash: string; sourceImage: string }[] = [],
) {
  const [mode, setMode] = useState<'tags' | 'merge' | null>(null);
  const enabled = mode !== null;
  const [mergeHashes, setMergeHashes] = useState<[string, string] | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const available = useMemo(() => new Set(slugs), [slugs]);
  // Hidden selections must never leak into a later batch write after filtering changes.
  const selected = [...selection].filter((slug) => mode === 'merge' || available.has(slug));
  const marquee = useGalleryMarquee({
    enabled: enabled && !pending && !mergeHashes,
    selected: new Set(selected),
    onChange: setSelection,
    limit: mode === 'merge' ? 2 : Infinity,
    selectOnClick: mode === 'merge',
  });
  const text = locale.startsWith('zh')
    ? {
        mode: '批量标签',
        all: '全选筛选结果',
        clear: '清空选择',
        edit: '批量编辑标签',
        exit: '退出多选',
        select: '选择来源',
        count: '个来源',
        waiting: '正在完成筛选…',
        leave: '离开此页面会丢失当前的图片选择，确定离开吗？',
      }
    : locale.startsWith('ja')
      ? {
          mode: 'タグを一括編集',
          all: '検索結果をすべて選択',
          clear: '選択を解除',
          edit: 'タグを一括編集する',
          exit: '選択を終了',
          select: '元画像を選択',
          count: '件',
          waiting: '検索中…',
          leave: 'このページを離れると画像の選択が失われます。移動しますか？',
        }
      : {
          mode: 'Bulk tags',
          all: 'Select all filtered results',
          clear: 'Clear selection',
          edit: 'Edit selected tags',
          exit: 'Exit selection',
          select: 'Select source',
          count: 'sources',
          waiting: 'Finishing search…',
          leave: 'Leaving this page will discard your image selection. Leave anyway?',
        };
  useEffect(() => {
    if (enabled && !mergeHashes) return guardGalleryNavigation(text.leave);
  }, [enabled, text.leave, mergeHashes]);
  const toggle = (slug: string) => {
    setSelection((previous) => {
      const next = new Set([...previous].filter((id) => mode === 'merge' || available.has(id)));
      if (next.has(slug)) next.delete(slug);
      else if (mode !== 'merge' || next.size < 2) next.add(slug);
      return next;
    });
  };
  const controlClass =
    'inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border bg-background px-3 text-sm disabled:opacity-50';
  const zh = locale.startsWith('zh');
  const exit = () => {
    setMode(null);
    setSelection(new Set());
  };
  const confirmMerge = () => {
    const hashes = selected.map((slug) => mergeItems.find((item) => item.slug === slug)?.imageHash);
    if (hashes.length === 2 && hashes.every(Boolean)) setMergeHashes(hashes as [string, string]);
  };
  const actions = (
    <>
      {mode === 'tags' && (
        <button
          type="button"
          className={controlClass}
          disabled={pending || !available.size}
          onClick={() => setSelection(new Set(available))}
        >
          {text.all}
        </button>
      )}
      <button type="button" className={controlClass} disabled={!selected.length} onClick={() => setSelection(new Set())}>
        {text.clear}
      </button>
      <output aria-live="polite" className="text-muted-foreground text-xs tabular-nums">
        {pending ? text.waiting : `${selected.length} / ${mode === 'merge' ? 2 : available.size} ${text.count}`}
      </output>
      <button
        type="button"
        className={`${controlClass} border-primary text-primary`}
        disabled={pending || (mode === 'merge' ? selected.length !== 2 : !selected.length)}
        onClick={mode === 'merge' ? confirmMerge : () => $galleryTagEditor.set(selected)}
      >
        <Icon icon={mode === 'merge' ? 'ri:merge-cells-horizontal' : 'ri:price-tag-3-line'} className="size-4" />
        {mode === 'merge' ? (zh ? '确认两张并比较' : 'Compare selected pair') : text.edit}
      </button>
    </>
  );
  const exitButton = (
    <button type="button" className={controlClass} onClick={exit}>
      {text.exit}
    </button>
  );
  return {
    enabled,
    rootRef: marquee.rootRef,
    selected: new Set(selected),
    overlays: (
      <>
        {marquee.overlay}
        {enabled && !mergeHashes && (
          <GallerySelectionDock count={selected.length} locale={locale}>
            {mode === 'merge' &&
              selected.map((slug) => {
                const item = mergeItems.find((entry) => entry.slug === slug);
                return (
                  item && (
                    <button
                      type="button"
                      key={slug}
                      onClick={() => toggle(slug)}
                      className="flex items-center gap-2 rounded-lg border border-border p-2 text-xs"
                      aria-label={`${zh ? '取消选择' : 'Deselect'} ${item.imageHash.slice(0, 12)}`}
                    >
                      <img
                        src={getStyleGallerySourceThumbnail(item.sourceImage)}
                        alt=""
                        className="size-12 rounded-md object-cover"
                      />
                      <span className="flex-1 text-left">{item.imageHash.slice(0, 12)}</span>
                      <Icon icon="ri:close-line" />
                    </button>
                  )
                );
              })}
            {actions}
            {exitButton}
            <p className="text-muted-foreground text-xs">
              {zh
                ? '拖动框选；Ctrl / Shift / ⌘ 追加选择。可滚轮浏览。'
                : 'Drag to select. Ctrl / Shift / ⌘ adds to selection; scroll while dragging.'}
            </p>
          </GallerySelectionDock>
        )}
        {mergeHashes && (
          <StyleGalleryMerge
            key={mergeHashes.join(':')}
            locale={locale}
            initialHashes={mergeHashes}
            onClose={() => setMergeHashes(null)}
          />
        )}
      </>
    ),
    mergeButton: mergeItems.length ? (
      <button
        type="button"
        className={controlClass}
        aria-pressed={mode === 'merge'}
        onClick={() => {
          setMode('merge');
          setSelection(new Set());
        }}
      >
        <Icon icon="ri:merge-cells-horizontal" />
        {zh ? '合并卡片' : 'Merge cards'}
      </button>
    ) : null,
    toolbar: (
      <div className="flex flex-wrap items-center gap-2" data-gallery-selection>
        {enabled ? (
          exitButton
        ) : (
          <button
            type="button"
            className={controlClass}
            onClick={() => {
              setMode('tags');
              setSelection(new Set());
            }}
          >
            <Icon icon="ri:checkbox-multiple-line" className="size-4" />
            {text.mode}
          </button>
        )}
        {enabled && actions}
        {mode === 'merge' && (
          <p className="basis-full text-muted-foreground text-xs">
            {zh
              ? '选择两张卡片；可以继续搜索、筛选或以图搜图，已选卡片会保留。最多选择 2 张。'
              : 'Choose exactly two cards. Search and filters keep your selected pair.'}
          </p>
        )}
      </div>
    ),
    checkbox: (slug: string, compact = false) =>
      enabled ? (
        <label
          className={`absolute z-20 flex cursor-pointer items-center justify-center border border-white/40 bg-black/60 text-white shadow-sm backdrop-blur-md ${compact ? 'top-1 left-1 size-7 rounded-sm' : 'top-2 left-1/2 size-9 -translate-x-1/2 rounded-lg'}`}
        >
          <input
            type="checkbox"
            checked={available.has(slug) && selection.has(slug)}
            disabled={pending || (mode === 'merge' && selected.length >= 2 && !selection.has(slug))}
            aria-label={`${text.select} ${slug}`}
            onChange={() => toggle(slug)}
            className="size-4 accent-rose-500"
          />
        </label>
      ) : null,
  };
}
