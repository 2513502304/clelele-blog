import { useEffect, useRef, useState } from 'react';
import { RiCheckLine } from 'react-icons/ri';
import { studioLanguage } from './StyleGalleryGenerationFields';

interface Props {
  indices: number[];
  published: number[];
  selected: number;
  select: (index: number) => void;
  locale: string;
  jobId: string;
  request: (path: string, body?: object, signal?: AbortSignal) => Promise<Response>;
}

/** Only fetch small private thumbnails for the current batch. Switch images with buttons, arrows or a focused wheel. */
export function OutputStrip({ indices, published, selected, select, locale, jobId, request }: Props) {
  const l = studioLanguage(locale);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const strip = useRef<HTMLFieldSetElement>(null);
  const key = indices.join(',');
  useEffect(() => {
    const controller = new AbortController();
    const urls: string[] = [];
    setThumbs({});
    void Promise.allSettled(
      key
        .split(',')
        .filter(Boolean)
        .map(async (value) => {
          const response = await request(`?preview=${jobId}&index=${value}&thumb=1`, undefined, controller.signal);
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          setThumbs((old) => ({ ...old, [Number(value)]: url }));
        }),
    );
    return () => {
      controller.abort();
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [key, request, jobId]);
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
          {thumbs[index] && <img src={thumbs[index]} alt="" />}
          <span>{String(index + 1).padStart(2, '0')}</span>
          {published.includes(index) && <RiCheckLine />}
        </button>
      ))}
    </fieldset>
  );
}
