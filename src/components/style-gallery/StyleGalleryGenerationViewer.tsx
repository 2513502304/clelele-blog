import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RiAddLine,
  RiArrowLeftRightLine,
  RiCloseLine,
  RiFocus3Line,
  RiFullscreenLine,
  RiLayoutColumnLine,
  RiSubtractLine,
} from 'react-icons/ri';
import type { StyleGalleryImageRef } from '@/types/style-gallery';
import { studioLanguage } from './StyleGalleryGenerationFields';

const zoomStep = 1.12;
const pinchResponse = 0.6;

/** Use travel distance so a trackpad can split one gesture into many small wheel events. */
function wheelZoom(event: WheelEvent, height: number) {
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? height : 1;
  // Browsers represent trackpad pinches as Ctrl+wheel with much smaller deltas than a scroll wheel.
  const gain = event.ctrlKey ? pinchResponse / 100 : Math.log(1.08) / 100;
  const exponent = Math.max(-Math.log(zoomStep), Math.min(Math.log(zoomStep), -event.deltaY * unit * gain));
  return Math.exp(exponent);
}

interface ComparisonProps {
  reference: string;
  result: string;
  locale: string;
  split: number;
  setSplit: (value: number) => void;
  side?: boolean;
  transform?: string;
}

/** Clip the reference pane after transforming its image so the seam stays under the handle at any zoom. */
export function ComparisonImages({ reference, result, locale, split, setSplit, side, transform }: ComparisonProps) {
  const l = studioLanguage(locale);
  const boundary = l('参考图对比分界', '比較の境界', 'Comparison divider');
  return (
    <div className="studio-compare" data-side={Boolean(side)}>
      <div className="studio-pair-pane" style={side ? undefined : { clipPath: `inset(0 ${100 - split}% 0 0)` }}>
        <img src={reference} alt={l('条目参考图', '参照画像', 'Reference image')} draggable={false} style={{ transform }} />
      </div>
      <div className="studio-pair-pane">
        <img src={result} alt={l('生成结果', '生成結果', 'Generated result')} draggable={false} style={{ transform }} />
      </div>
      {!side && (
        <button
          type="button"
          className="studio-seam"
          style={{ left: `${split}%` }}
          role="slider"
          aria-label={boundary}
          tabIndex={transform ? 0 : -1}
          aria-hidden={transform ? undefined : true}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={split}
          aria-valuetext={`${split}%`}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const rect = e.currentTarget.parentElement?.getBoundingClientRect();
            if (!rect?.width) return;
            setSplit(Math.round(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))));
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setSplit(50);
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 10 : 1;
            const values: Record<string, number> = { ArrowLeft: split - step, ArrowRight: split + step, Home: 0, End: 100 };
            if (e.key in values) {
              e.preventDefault();
              e.stopPropagation();
              setSplit(Math.max(0, Math.min(100, values[e.key])));
            }
          }}
        >
          <span>
            <RiArrowLeftRightLine />
          </span>
        </button>
      )}
      {!transform && (
        <input
          type="range"
          className="studio-inline-split"
          aria-label={boundary}
          min={0}
          max={100}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
        />
      )}
      <small>{l('条目参考图', '参照画像', 'Reference')}</small>
      <small>{l('生成结果', '生成結果', 'Result')}</small>
    </div>
  );
}

interface ViewerProps {
  src: string;
  alt: string;
  locale: string;
  references?: StyleGalleryImageRef[];
  initialHash?: string;
}

/** Both inspection modes use the same bounded wheel, pinch and drag gestures. */
export function GenerationViewer({ src, alt, locale, references, initialHash }: ViewerProps) {
  const l = studioLanguage(locale);
  const [hash, selectHash] = useState(initialHash);
  const [side, setSide] = useState(false);
  const [split, setSplit] = useState(50);
  const reference = references?.find((item) => item.imageHash === hash) ?? references?.[0];
  const dialog = useRef<HTMLDialogElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [{ scale, x, y }, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const reset = () => setView({ scale: 1, x: 0, y: 0 });
  // Clamp against the fitted image, not the letterbox, so portrait originals stay in view while panning.
  const move = useCallback((factor: number, dx = 0, dy = 0, anchor?: { x: number; y: number }) => {
    const area = surface.current;
    if (!area) return;
    const panes = [...area.querySelectorAll<HTMLElement>('.studio-pair-pane')];
    const frames = (panes.length ? panes : [area]).map((pane) => pane.getBoundingClientRect());
    const rect = frames.find((r) => anchor && r.left <= anchor.x && anchor.x <= r.right) ?? frames[0];
    const fitted = [...area.querySelectorAll('img')]
      .filter((img) => img.naturalWidth)
      .map((img) => {
        const fit = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
        return { width: img.naturalWidth * fit, height: img.naturalHeight * fit };
      });
    if (!fitted.length) return;
    // Use the shared pannable extent to keep both images visible when their aspect ratios differ.
    const width = Math.min(...fitted.map((image) => image.width)),
      height = Math.min(...fitted.map((image) => image.height));
    const ax = anchor ? anchor.x - rect.left - rect.width / 2 : 0,
      ay = anchor ? anchor.y - rect.top - rect.height / 2 : 0;
    setView((v) => {
      const next = Math.max(1, Math.min(6, v.scale * factor)),
        ratio = next / v.scale;
      const constrain = (value: number, extent: number) => Math.max(-Math.max(0, extent), Math.min(Math.max(0, extent), value));
      return {
        scale: next,
        x: constrain(ax + (v.x - ax) * ratio + dx, (width * next - rect.width) / 2),
        y: constrain(ay + (v.y - ay) * ratio + dy, (height * next - rect.height) / 2),
      };
    });
  }, []);
  useEffect(() => {
    const area = surface.current;
    if (!open || !area) return;
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      event.preventDefault();
      move(wheelZoom(event, area.clientHeight), 0, 0, { x: event.clientX, y: event.clientY });
    };
    area.addEventListener('wheel', wheel, { passive: false });
    return () => area.removeEventListener('wheel', wheel);
  }, [open, move]);
  const transform = `translate(${x}px,${y}px) scale(${scale})`;
  const expand = reference
    ? l('放大对比', '比較ビューを開く', 'Inspect comparison')
    : l('放大查看', '拡大表示', 'Inspect image');
  return (
    <>
      <button
        type="button"
        className={reference ? 'studio-secondary studio-comparison-launch' : 'studio-image-launch'}
        aria-label={expand}
        onClick={() => {
          reset();
          selectHash(initialHash);
          setSide(false);
          setSplit(50);
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        {reference ? (
          <>
            <RiLayoutColumnLine />
            {expand}
          </>
        ) : (
          <>
            <img src={src} alt={alt} />
            <span>
              <RiFullscreenLine />
              {expand}
            </span>
          </>
        )}
      </button>
      <dialog
        ref={dialog}
        aria-label={expand}
        className="studio-viewer"
        data-comparison={Boolean(reference)}
        onClose={() => {
          pointers.current.clear();
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
          if (['+', '=', '-', '0', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            if (e.key === '0') reset();
            else if (e.key === '-') move(1 / zoomStep);
            else if (e.key === '+' || e.key === '=') move(zoomStep);
            else
              move(
                1,
                e.key === 'ArrowLeft' ? 32 : e.key === 'ArrowRight' ? -32 : 0,
                e.key === 'ArrowUp' ? 32 : e.key === 'ArrowDown' ? -32 : 0,
              );
          }
        }}
      >
        {open && (
          <>
            <div className="studio-viewer-bar">
              <strong>{reference ? l('对比参考', '参照画像と比較', 'Compare reference') : alt}</strong>
              <button type="button" aria-label={l('缩小', '縮小', 'Zoom out')} onClick={() => move(1 / zoomStep)}>
                <RiSubtractLine />
              </button>
              <output>{Math.round(scale * 100)}%</output>
              <button type="button" aria-label={l('放大', '拡大', 'Zoom in')} onClick={() => move(zoomStep)}>
                <RiAddLine />
              </button>
              <button type="button" aria-label={l('适应画布', '全体表示', 'Fit image')} onClick={reset}>
                <RiFocus3Line />
              </button>
              <button type="button" aria-label={l('关闭', '閉じる', 'Close')} onClick={() => dialog.current?.close()}>
                <RiCloseLine />
              </button>
            </div>
            {reference && (
              <div className="studio-comparison-tools">
                <label>
                  {l('选择参考图', '参照画像', 'Reference image')}
                  <select
                    value={reference.imageHash}
                    onChange={(e) => {
                      selectHash(e.target.value);
                      reset();
                    }}
                  >
                    {references?.map((ref, i) => (
                      <option key={ref.imageHash} value={ref.imageHash}>
                        {i + 1} · {ref.sourceImageAlt || l('条目参考图', '参照画像', 'Entry reference')}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="studio-compare-modes">
                  {[false, true].map((value) => (
                    <button
                      key={String(value)}
                      type="button"
                      aria-pressed={side === value}
                      onClick={() => {
                        setSide(value);
                        reset();
                      }}
                    >
                      {value ? l('并排', '並列', 'Side by side') : l('滑杆', 'スライダー', 'Slider')}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div
              role="application"
              aria-label={l('图像缩放与平移', '画像の拡大と移動', 'Image zoom and pan')}
              className="studio-inspect-surface"
              ref={surface}
              onDoubleClick={() => {
                if (scale === 1) move(2);
                else reset();
              }}
              onPointerDown={(e) => {
                pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const from = pointers.current.get(e.pointerId);
                if (!from) return;
                const next = { x: e.clientX, y: e.clientY };
                pointers.current.set(e.pointerId, next);
                const mate = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
                if (!mate) {
                  move(1, next.x - from.x, next.y - from.y);
                  return;
                }
                const previous = Math.hypot(from.x - mate.x, from.y - mate.y);
                const distance = Math.hypot(next.x - mate.x, next.y - mate.y);
                // Nearly coincident fingertips give unstable ratios when they cross.
                if (Math.min(previous, distance) >= 8)
                  move((distance / previous) ** pinchResponse, (next.x - from.x) / 2, (next.y - from.y) / 2, {
                    x: (from.x + mate.x) / 2,
                    y: (from.y + mate.y) / 2,
                  });
              }}
              onLostPointerCapture={(e) => pointers.current.delete(e.pointerId)}
            >
              {reference ? (
                <ComparisonImages
                  result={src}
                  reference={reference.sourceImage}
                  locale={locale}
                  transform={transform}
                  split={split}
                  setSplit={setSplit}
                  side={side}
                />
              ) : (
                <img src={src} draggable={false} alt={alt} style={{ transform }} />
              )}
            </div>
            {reference && !side && (
              <label className="studio-split-scale">
                {l('参考占比', '参照の割合', 'Reference share')}
                <input type="range" min="0" max="100" value={split} onChange={(e) => setSplit(Number(e.target.value))} />
                <span>{split}%</span>
              </label>
            )}
            <p>
              {l(
                '滚轮或双指缩放 · 拖动平移 · 双击切换缩放',
                'ホイールで拡大・ドラッグで移動・ダブルクリックで切替',
                'Scroll or pinch to zoom · Drag to pan · Double-click to toggle zoom',
              )}
            </p>
          </>
        )}
      </dialog>
    </>
  );
}
