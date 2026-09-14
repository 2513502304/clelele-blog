import { Icon } from '@iconify/react';
import { guardGalleryNavigation } from '@lib/style-gallery-navigation-guard';
import { $galleryTagEditor } from '@store/gallery-tags';
import { useEffect, useMemo, useState } from 'react';

/** Selection covers all filtered source IDs, including cards not yet progressively mounted. */
export function useGalleryTagSelection(slugs: string[], locale: string, pending = false) {
  const [enabled, setEnabled] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const available = useMemo(() => new Set(slugs), [slugs]);
  // Hidden selections must never leak into a later batch write after filtering changes.
  const selected = [...selection].filter((slug) => available.has(slug));
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
        leave: '离开此页面会丢失当前批量标签的图片选择，确定离开吗？',
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
          leave: 'Leaving this page will discard your bulk-tag image selection. Leave anyway?',
        };
  useEffect(() => {
    if (enabled) return guardGalleryNavigation(text.leave);
  }, [enabled, text.leave]);
  const toggle = (slug: string) => {
    setSelection((previous) => {
      const next = new Set([...previous].filter((id) => available.has(id)));
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };
  const controlClass =
    'inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border bg-background px-3 text-sm disabled:opacity-50';
  return {
    enabled,
    toolbar: (
      <div className="flex flex-wrap items-center gap-2" data-gallery-selection>
        <button
          type="button"
          className={controlClass}
          aria-pressed={enabled}
          onClick={() => {
            setEnabled(!enabled);
            setSelection(new Set());
          }}
        >
          <Icon icon={enabled ? 'ri:close-line' : 'ri:checkbox-multiple-line'} className="size-4" />
          {enabled ? text.exit : text.mode}
        </button>
        {enabled && (
          <>
            <button
              type="button"
              className={controlClass}
              disabled={pending || !available.size}
              onClick={() => setSelection(new Set(available))}
            >
              {text.all}
            </button>
            <button type="button" className={controlClass} disabled={!selected.length} onClick={() => setSelection(new Set())}>
              {text.clear}
            </button>
            <output className="text-muted-foreground text-xs tabular-nums">
              {pending ? text.waiting : `${selected.length} / ${available.size} ${text.count}`}
            </output>
            <button
              type="button"
              className={`${controlClass} border-primary text-primary`}
              disabled={pending || !selected.length}
              onClick={() => $galleryTagEditor.set(selected)}
            >
              <Icon icon="ri:price-tag-3-line" className="size-4" />
              {text.edit}
            </button>
          </>
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
            disabled={pending}
            aria-label={`${text.select} ${slug}`}
            onChange={() => toggle(slug)}
            className="size-4 accent-rose-500"
          />
        </label>
      ) : null,
  };
}
