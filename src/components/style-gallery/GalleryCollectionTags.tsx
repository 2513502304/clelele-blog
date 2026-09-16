import {
  getGalleryTagVocabulary,
  isValidGalleryTag,
  MAX_GALLERY_TAGS_PER_ITEM,
  normalizeGalleryTag,
} from '@lib/style-gallery-tags';
import { useGalleryTags } from '@store/gallery-tags';
import { useId, useRef, useState } from 'react';

/** Draft-only categories reuse the page's vocabulary; persistence happens with collection submission. */
export default function GalleryCollectionTags({
  locale,
  tags,
  onChange,
  query,
  onQueryChange,
}: {
  locale: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const { index } = useGalleryTags();
  const [active, setActive] = useState(0);
  const id = useId();
  const section = useRef<HTMLElement>(null);
  const zh = locale.startsWith('zh');
  const normalized = normalizeGalleryTag(query);
  const choices =
    tags.length >= MAX_GALLERY_TAGS_PER_ITEM
      ? []
      : getGalleryTagVocabulary(index)
          .map(({ tag }) => tag)
          .filter((tag) => !tags.includes(tag) && (!normalized || tag.includes(normalized)));
  if (
    tags.length < MAX_GALLERY_TAGS_PER_ITEM &&
    isValidGalleryTag(normalized) &&
    !tags.includes(normalized) &&
    !choices.includes(normalized)
  )
    choices.push(normalized);
  const selected = Math.min(active, Math.max(0, choices.length - 1));
  const add = (tag: string) => {
    onChange([...new Set([...tags, tag])]);
    onQueryChange('');
    setActive(0);
  };
  return (
    <section ref={section} className="space-y-2 text-sm" aria-label={zh ? '标签（选填）' : 'Tags (optional)'}>
      <label htmlFor={id}>{zh ? '标签（选填）' : 'Tags (optional)'}</label>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className="rounded-full border border-primary/20 bg-primary/5 px-2 py-1 text-primary text-xs"
            aria-label={`${zh ? '移除' : 'Remove'} ${tag}`}
            onClick={() => onChange(tags.filter((value) => value !== tag))}
          >
            #{tag} ×
          </button>
        ))}
      </div>
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={`${id}-choices`}
        aria-expanded={choices.length > 0}
        aria-activedescendant={choices.length ? `${id}-${selected}` : undefined}
        value={query}
        maxLength={100}
        placeholder={zh ? '输入或选择标签' : 'Type or choose a tag'}
        className="h-10 w-full rounded-lg border border-border bg-background px-3 outline-none focus:border-primary"
        onFocus={() => section.current?.scrollIntoView({ block: 'nearest' })}
        onChange={(event) => {
          onQueryChange(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (choices.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            const next = (selected + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
            setActive(next);
            document.getElementById(`${id}-${next}`)?.scrollIntoView({ block: 'nearest' });
          } else if (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey && choices.length)) {
            event.preventDefault();
            if (choices.length) add(choices[selected]);
          }
        }}
      />
      <div
        id={`${id}-choices`}
        role="listbox"
        aria-label={zh ? '已有标签' : 'Existing tags'}
        className="vertical-scrollbar flex max-h-24 min-h-16 flex-wrap content-start gap-1 overflow-y-auto overscroll-contain rounded-lg border border-border/60 p-2"
      >
        {choices.map((tag, i) => (
          <button
            type="button"
            role="option"
            aria-selected={i === selected}
            id={`${id}-${i}`}
            key={tag}
            tabIndex={-1}
            className={`rounded-md px-2 py-1 text-xs ${i === selected ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
            onClick={() => add(tag)}
          >
            #{tag}
          </button>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        {zh ? '最多 12 个 · ↑ ↓ 选择 · Tab / Enter 填入' : 'Up to 12 · ↑ ↓ select · Tab / Enter add'}
      </p>
    </section>
  );
}
