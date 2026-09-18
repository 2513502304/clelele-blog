import { combineGallerySelection, intersectsSelection, type SelectionRect } from '@lib/style-gallery-selection';
import { useEffect, useRef, useState } from 'react';

/** Desktop rubber-band selection in document coordinates, including wheel scrolling and newly mounted cards.
 * Form controls retain their own gestures. Touch users keep the existing checkboxes; no global touch lock.
 */
export function useGalleryMarquee({
  enabled,
  selected,
  onChange,
  limit = Infinity,
  selectOnClick = false,
}: {
  enabled: boolean;
  selected: Set<string>;
  onChange: (ids: Set<string>) => void;
  limit?: number;
  selectOnClick?: boolean;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const latest = useRef({ selected, onChange, limit });
  latest.current = { selected, onChange, limit };
  const [box, setBox] = useState<SelectionRect | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;
    // Only merge mode turns ordinary card clicks into selection; bulk modes retain their links/lightboxes.
    if (selectOnClick) root.dataset.gallerySelecting = 'true';
    let gesture: {
      id: number;
      x: number;
      y: number;
      clientX: number;
      clientY: number;
      append: boolean;
      base: Set<string>;
      dragging: boolean;
    } | null = null;
    let frame = 0;
    let suppressUntil = 0;
    const suppressClick = () => {
      suppressUntil = Date.now() + 500;
      // The document's navigation guard runs before this root's click capture listener.
      root.dataset.galleryMarqueeUntil = String(suppressUntil);
    };
    const allowed = (target: EventTarget | null) => {
      if (!(target instanceof Element) || !root.contains(target) || !target.closest('[data-gallery-marquee-area]'))
        return false;
      if (target.closest('input,textarea,select,label,[data-no-marquee]')) return false;
      const button = target.closest('button');
      return !button || Boolean(button.querySelector('img'));
    };
    const render = () => {
      frame = 0;
      if (!gesture?.dragging) return;
      const endX = gesture.clientX + window.scrollX;
      const endY = gesture.clientY + window.scrollY;
      const rect = {
        left: Math.min(gesture.x, endX),
        top: Math.min(gesture.y, endY),
        right: Math.max(gesture.x, endX),
        bottom: Math.max(gesture.y, endY),
      };
      const hits: string[] = [];
      for (const element of root.querySelectorAll<HTMLElement>('[data-gallery-selection-id]')) {
        const bounds = element.getBoundingClientRect();
        if (
          intersectsSelection(rect, {
            left: bounds.left + window.scrollX,
            right: bounds.right + window.scrollX,
            top: bounds.top + window.scrollY,
            bottom: bounds.bottom + window.scrollY,
          })
        )
          hits.push(element.dataset.gallerySelectionId ?? '');
      }
      const next = combineGallerySelection(gesture.base, hits, gesture.append, latest.current.limit);
      // Pointer motion within the same cards must not rerender the entire gallery every frame.
      if (next.size !== latest.current.selected.size || [...next].some((id) => !latest.current.selected.has(id)))
        latest.current.onChange(next);
      setBox({
        left: rect.left - window.scrollX,
        right: rect.right - window.scrollX,
        top: rect.top - window.scrollY,
        bottom: rect.bottom - window.scrollY,
      });
    };
    const schedule = () => {
      if (gesture?.dragging && !frame) frame = requestAnimationFrame(render);
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType !== 'mouse' || !allowed(event.target)) return;
      gesture = {
        id: event.pointerId,
        x: event.pageX,
        y: event.pageY,
        clientX: event.clientX,
        clientY: event.clientY,
        append: event.ctrlKey || event.shiftKey || event.metaKey,
        base: new Set(latest.current.selected),
        dragging: false,
      };
    };
    const move = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      gesture.clientX = event.clientX;
      gesture.clientY = event.clientY;
      if (Math.hypot(event.pageX - gesture.x, event.pageY - gesture.y) > 5) gesture.dragging = true;
      if (gesture.dragging) {
        event.preventDefault();
        schedule();
      }
    };
    const finish = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      if (gesture?.dragging) {
        render();
        suppressClick();
      }
      gesture = null;
      cancelAnimationFrame(frame);
      frame = 0;
      setBox(null);
    };
    const cancel = () => {
      if (gesture?.dragging) suppressClick();
      if (gesture) latest.current.onChange(gesture.base);
      gesture = null;
      cancelAnimationFrame(frame);
      frame = 0;
      setBox(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture) {
        event.preventDefault();
        cancel();
      }
    };
    const click = (event: MouseEvent) => {
      if (Date.now() < suppressUntil && allowed(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!selectOnClick || !allowed(event.target)) return;
      const card = (event.target as Element).closest<HTMLElement>('[data-gallery-selection-id]');
      const id = card?.dataset.gallerySelectionId;
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      const next = new Set(latest.current.selected);
      if (next.has(id)) next.delete(id);
      else if (next.size < latest.current.limit) next.add(id);
      latest.current.onChange(next);
    };
    const preventNative = (event: Event) => {
      if (allowed(event.target)) event.preventDefault();
    };
    root.addEventListener('pointerdown', down);
    root.addEventListener('click', click, true);
    root.addEventListener('dragstart', preventNative);
    root.addEventListener('selectstart', preventNative);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', schedule, true);
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      setBox(null);
      delete root.dataset.gallerySelecting;
      delete root.dataset.galleryMarqueeUntil;
      observer.disconnect();
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('click', click, true);
      root.removeEventListener('dragstart', preventNative);
      root.removeEventListener('selectstart', preventNative);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [enabled, selectOnClick]);
  return {
    rootRef,
    overlay: box && (
      <div
        aria-hidden="true"
        data-gallery-marquee
        className="pointer-events-none fixed z-40 border border-primary bg-primary/15"
        style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }}
      />
    ),
  };
}
