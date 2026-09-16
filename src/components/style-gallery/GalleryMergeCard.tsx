import { getStyleGalleryExampleThumbnailSource, getStyleGallerySourceThumbnail } from '@lib/style-gallery-image-key';
import type { GalleryMergeCard as Card, GalleryMergeSelection, GalleryMergeSide } from '@lib/style-gallery-merge-types';
import { useMemo } from 'react';
import GalleryCollectionPreview from './GalleryCollectionPreview';

const box =
  'flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5';

/** Selection controls are independent of viewing controls, so opening a lightbox cannot change a merge decision. */
export default function GalleryMergeCard({
  card,
  side,
  choice,
  onChange,
  locale,
}: {
  card: Card;
  side: GalleryMergeSide;
  choice: GalleryMergeSelection;
  onChange: (next: GalleryMergeSelection) => void;
  locale: string;
}) {
  const zh = locale.startsWith('zh');
  const { item } = card;
  const references = useMemo(
    () =>
      item.images.map((image) => ({
        src: image.sourceImage,
        thumbnail: getStyleGallerySourceThumbnail(image.sourceImage),
        alt: item.title,
      })),
    [item],
  );
  const examples = useMemo(
    () =>
      item.examples.map((image) => ({
        src: image.src,
        thumbnail: getStyleGalleryExampleThumbnailSource(image.src),
        alt: image.alt,
      })),
    [item],
  );
  const likes = Object.values(card.likeCounts).reduce((total, count) => total + count, 0);
  return (
    <section
      className="min-w-0 space-y-4 rounded-2xl border border-border bg-background/80 p-4"
      aria-label={`${zh ? '卡片' : 'Card'} ${side + 1}`}
    >
      <h3 className="font-mono font-semibold text-base">{item.imageHash.slice(0, 12)}</h3>
      <label className={box}>
        <input
          type="radio"
          name="merge-identity"
          checked={choice.keep === side}
          onChange={() => onChange({ ...choice, keep: side })}
          className="mt-1 accent-primary"
        />
        <span>
          {zh ? '保留这张卡片的主图、hash 和链接' : 'Keep this card’s reference images, hash and URL'}
          <small className="mt-1 block text-muted-foreground">
            {zh ? '另一张卡片将移除，旧链接跳转至此' : 'The other card is removed; its URL redirects here'}
          </small>
        </span>
      </label>
      <GalleryCollectionPreview images={references} locale={locale} />
      <label className={box}>
        <input
          type="radio"
          name="merge-date"
          checked={choice.date === side}
          onChange={() => onChange({ ...choice, date: side })}
          className="mt-1 accent-primary"
        />
        <span>
          {zh ? '导入日期' : 'Imported'}
          <span className="block text-muted-foreground">
            {new Date(item.date).toLocaleString(locale, { timeZone: 'Asia/Shanghai' })}
          </span>
        </span>
      </label>
      <div className="space-y-2">
        <h4 className="font-medium text-sm">{zh ? '模型 Prompt（可多选）' : 'Generated prompts (multiple)'}</h4>
        {item.prompts.map((prompt) => (
          <label key={prompt.id} className={box}>
            <input
              type="checkbox"
              className="mt-1 accent-primary"
              checked={choice.prompts.some((value) => value.side === side && value.id === prompt.id)}
              onChange={(event) =>
                onChange({
                  ...choice,
                  prompts: event.target.checked
                    ? [...choice.prompts, { side, id: prompt.id }]
                    : choice.prompts.filter((value) => !(value.side === side && value.id === prompt.id)),
                })
              }
            />
            <span className="min-w-0 flex-1">
              <span className="font-semibold text-primary text-xs">
                {prompt.model || (zh ? '未注明模型' : 'Unspecified model')}
              </span>
              <span
                data-merge-prompt
                className="vertical-scrollbar mt-2 block max-h-44 overflow-y-scroll overscroll-contain whitespace-pre-wrap break-words leading-relaxed [scrollbar-gutter:stable]"
              >
                {prompt.prompt}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div className="space-y-2">
        <h4 className="font-medium text-sm">{zh ? '用户原始 Prompt（单选）' : 'Original prompt (one)'}</h4>
        {item.prompts
          .filter(
            (prompt, i, values) =>
              prompt.originalPrompt && values.findIndex((other) => other.originalPrompt === prompt.originalPrompt) === i,
          )
          .map((prompt) => (
            <label key={prompt.id} className={box}>
              <input
                type="radio"
                name="merge-original"
                className="mt-1 accent-primary"
                checked={choice.original?.side === side && choice.original.id === prompt.id}
                onChange={() => onChange({ ...choice, original: { side, id: prompt.id } })}
              />
              <span
                data-merge-original
                className="vertical-scrollbar max-h-32 min-w-0 flex-1 overflow-y-scroll overscroll-contain whitespace-pre-wrap break-words [scrollbar-gutter:stable]"
              >
                {prompt.originalPrompt}
              </span>
            </label>
          ))}
        {!item.prompts.some((prompt) => prompt.originalPrompt) && (
          <p className="text-muted-foreground text-xs">{zh ? '未填写' : 'Not provided'}</p>
        )}
      </div>
      <label className={box}>
        <input
          type="checkbox"
          className="mt-1 accent-primary"
          checked={choice.examples.includes(side)}
          onChange={(event) =>
            onChange({
              ...choice,
              examples: event.target.checked ? [...choice.examples, side] : choice.examples.filter((value) => value !== side),
            })
          }
        />
        <span>
          Sub-images <strong>{examples.length}</strong>
          <span className="ml-3 text-rose-500">♥ {likes}</span>
          <small className="mt-1 block text-muted-foreground">
            {zh ? '保留这组子图及其点赞；可同时选中两组' : 'Keep this group and its likes; both groups may be selected'}
          </small>
        </span>
      </label>
      {examples.length > 0 && <GalleryCollectionPreview images={examples} locale={locale} label={zh ? '子图' : 'Sub-images'} />}
      <fieldset className="flex flex-wrap gap-2" aria-label={zh ? '保留标签' : 'Keep tags'}>
        {card.tags.map((tag) => (
          <button
            key={tag}
            type="button"
            aria-pressed={choice.tags.includes(tag)}
            onClick={() =>
              onChange({
                ...choice,
                tags: choice.tags.includes(tag) ? choice.tags.filter((value) => value !== tag) : [...choice.tags, tag],
              })
            }
            className={`rounded-full border px-3 py-1 text-xs ${choice.tags.includes(tag) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
          >
            #{tag}
          </button>
        ))}
      </fieldset>
    </section>
  );
}
