import { useEffect, useRef } from 'react';
import { RiCheckLine } from 'react-icons/ri';
import { studioLanguage } from './StyleGalleryGenerationFields';

import type { GenerationPlatform } from '@lib/style-gallery-generation-settings';
import { useThumbnail, type Thumbnails, type ThumbnailProps } from './useStudioReviewImage';

function StripImage(props: ThumbnailProps) {
  const src = useThumbnail(props);
  return src ? <img src={src} alt="" /> : null;
}

interface Props {
  indices: number[];
  published: number[];
  selected: number;
  select: (index: number) => void;
  locale: string;
  jobId: string;
  pool: Thumbnails;
  base: string;
  platform: GenerationPlatform;
  credential: string;
}

/** Only fetch small private thumbnails for the current batch. Switch images with buttons, arrows or a focused wheel. */
export function OutputStrip({ indices, published, selected, select, locale, jobId, pool, base, platform, credential }: Props) {
  const l = studioLanguage(locale);
  const strip = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    let last = 0;
    const wheel = (event: WheelEvent) => {
      // Let normal page scrolling pass until the user has focused a thumbnail.
      if (!el.contains(document.activeElement) || event.ctrlKey) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      const buttons = Array.from(el.querySelectorAll('button'));
      const index = buttons.findIndex((b) => b.getAttribute('aria-pressed') === 'true');
      const next = buttons[index + Math.sign(delta)];
      if (!next) return;
      event.preventDefault();
      if (performance.now() - last < 160) return;
      last = performance.now();
      next.focus({ preventScroll: true });
      next.click();
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  return (
    <fieldset className="studio-filmstrip" ref={strip} aria-label={l('生成图片', '生成画像', 'Generated images')}>
      {indices.map((index, i) => (
        <button
          type="button"
          key={index}
          aria-pressed={selected === index}
          aria-label={l(`第 ${index + 1} 张`, `画像 ${index + 1}`, `Image ${index + 1}`)}
          onClick={() => select(index)}
          onKeyDown={(e) => {
            const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : undefined;
            if (next === undefined || indices[next] === undefined) return;
            e.preventDefault();
            select(indices[next]);
            strip.current?.querySelectorAll('button')[next]?.focus();
          }}
        >
          <StripImage
            pool={pool}
            url={`${base}?preview=${jobId}&index=${index}&thumb=fit`}
            platform={platform}
            credential={credential}
          />
          <span>{String(index + 1).padStart(2, '0')}</span>
          {published.includes(index) && <RiCheckLine />}
        </button>
      ))}
    </fieldset>
  );
}
