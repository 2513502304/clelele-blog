import { useEffect, useRef } from 'react';

/** Drag any mouse surface after a small threshold; ordinary button clicks and scrollbars remain native. */
export function useDraggablePanel() {
  const ref = useRef<HTMLElement>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    let drag: { id: number; x: number; y: number; left: number; top: number; moved: boolean } | null = null;
    let frame = 0;
    let point: { x: number; y: number } | null = null;
    const place = (x: number, y: number) => {
      // The Lightbox fills the viewport. Position once per frame and do not rerender its prompt text while dragging.
      const left = Math.max(12, Math.min(x, innerWidth - panel.offsetWidth - 12));
      const top = Math.max(12, Math.min(y, innerHeight - panel.offsetHeight - 12));
      Object.assign(panel.style, { left: `${left}px`, top: `${top}px`, bottom: 'auto', right: 'auto' });
    };
    const down = (event: PointerEvent) => {
      event.stopPropagation();
      suppressClick.current = false;
      if (event.button !== 0 || event.pointerType !== 'mouse') return;
      const target = event.target as HTMLElement;
      // Form controls retain their own pointer gestures (especially sliders); ordinary buttons may still drag.
      if (target.closest('input, select, textarea, [contenteditable=true], [data-panel-no-drag]')) return;
      const scroll = target.closest<HTMLElement>('[data-prompt-text], [data-panel-scroll]');
      if (scroll && event.clientX >= scroll.getBoundingClientRect().left + scroll.clientWidth) return;
      const box = panel.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top, moved: false };
    };
    const move = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) drag.moved = true;
      if (!drag.moved) return;
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      point = { x: drag.left + event.clientX - drag.x, y: drag.top + event.clientY - drag.y };
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (point) place(point.x, point.y);
        });
    };
    const finish = (suppress = false) => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (point && drag?.moved) place(point.x, point.y);
      suppressClick.current = suppress && Boolean(drag?.moved);
      drag = null;
      point = null;
    };
    const up = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      // Only this release can produce a drag-generated click in the panel; cancellation must not swallow a later tap.
      finish(event.target instanceof Node && panel.contains(event.target));
    };
    const cancel = () => finish();
    const fit = () => {
      const box = panel.getBoundingClientRect();
      if (panel.style.top || box.right > innerWidth - 12 || box.bottom > innerHeight - 12 || box.top < 12)
        place(box.left, box.top);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(panel);
    panel.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', fit);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      panel.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', fit);
    };
  }, []);
  return {
    ref,
    onClickCapture: (event: React.MouseEvent) => {
      if (suppressClick.current && event.detail !== 0) {
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (!event.altKey || !ref.current) return;
      const delta = (
        { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] } as Record<string, number[]>
      )[event.key];
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      const box = ref.current.getBoundingClientRect();
      Object.assign(ref.current.style, {
        left: `${Math.max(12, Math.min(box.left + delta[0], innerWidth - box.width - 12))}px`,
        top: `${Math.max(12, Math.min(box.top + delta[1], innerHeight - box.height - 12))}px`,
        bottom: 'auto',
        right: 'auto',
      });
    },
  };
}
