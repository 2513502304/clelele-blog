import { useCallback, useEffect, useRef, useState } from 'react';
import { RiAddLine, RiCloseLine, RiFocus3Line, RiFullscreenLine, RiSubtractLine } from 'react-icons/ri';
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

/** Inspect the original in a native dialog. The scroll wheel is captured only inside the open viewer. */
export function GenerationViewer({ src, alt, locale }: { src: string; alt: string; locale: string }) {
  const l = studioLanguage(locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [{ scale, x, y }, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const reset = () => setView({ scale: 1, x: 0, y: 0 });
  // Clamp against the fitted image, not the letterbox, so portrait originals stay in view while panning.
  const move = useCallback((factor: number, dx = 0, dy = 0, anchor?: { x: number; y: number }) => {
    const rect = surface.current?.getBoundingClientRect(),
      image = surface.current?.querySelector('img');
    if (!rect || !image?.naturalWidth) return;
    const fit = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    const ax = anchor ? anchor.x - rect.left - rect.width / 2 : 0,
      ay = anchor ? anchor.y - rect.top - rect.height / 2 : 0;
    setView((v) => {
      const next = Math.max(1, Math.min(6, v.scale * factor)),
        ratio = next / v.scale;
      const constrain = (value: number, extent: number) => Math.max(-Math.max(0, extent), Math.min(Math.max(0, extent), value));
      return {
        scale: next,
        x: constrain(ax + (v.x - ax) * ratio + dx, (image.naturalWidth * fit * next - rect.width) / 2),
        y: constrain(ay + (v.y - ay) * ratio + dy, (image.naturalHeight * fit * next - rect.height) / 2),
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
  const expand = l('放大查看', '拡大表示', 'Inspect image');
  return (
    <>
      <button
        type="button"
        className="studio-image-launch"
        aria-label={expand}
        onClick={() => {
          reset();
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <img src={src} alt={alt} />
        <span>
          <RiFullscreenLine />
          {expand}
        </span>
      </button>
      <dialog
        ref={dialog}
        aria-label={expand}
        className="studio-viewer"
        onClose={() => {
          pointers.current.clear();
          setOpen(false);
        }}
        onKeyDown={(e) => {
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
              <strong>{alt}</strong>
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
              <img
                src={src}
                draggable={false}
                alt={alt}
                style={{
                  transform: `translate(${scale === 1 ? 0 : x}px,${scale === 1 ? 0 : y}px) scale(${scale})`,
                }}
              />
            </div>
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
