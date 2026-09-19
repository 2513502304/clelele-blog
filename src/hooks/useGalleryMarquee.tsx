import { combineGallerySelection, intersectsSelection, type SelectionRect } from '@lib/style-gallery-selection';
import { useEffect, useLayoutEffect, useRef } from 'react';

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
  // Native listeners must not observe state from a concurrent render that never commits.
  useLayoutEffect(() => {
    latest.current = { selected, onChange, limit };
  }, [selected, onChange, limit]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;
    // The Astro content surface includes its horizontal padding, but never the sidebar/header.
    const surface = root.closest<HTMLElement>('[data-gallery-selection-surface]') ?? root;
    // Paint outside transformed/clipped ancestors. Imperative RAF updates avoid a gallery-wide
    // React render for every pixel of pointer motion; selection state still belongs to React.
    const overlay = document.createElement('div');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.dataset.galleryMarquee = '';
    overlay.className = 'pointer-events-none fixed z-40 border border-primary bg-primary/15';
    overlay.style.display = 'none';
    document.body.append(overlay);
    let boundsDirty = true;
    let cards: { id: string; rect: SelectionRect }[] = [];
    const measure = () => {
      cards = [...root.querySelectorAll<HTMLElement>('[data-gallery-selection-id]')].map((element) => {
        const box = element.getBoundingClientRect();
        return {
          id: element.dataset.gallerySelectionId ?? '',
          rect: {
            left: box.left + window.scrollX,
            right: box.right + window.scrollX,
            top: box.top + window.scrollY,
            bottom: box.bottom + window.scrollY,
          },
        };
      });
      boundsDirty = false;
    };
    // Only merge mode turns ordinary card clicks into selection; bulk modes retain their links/lightboxes.
    if (selectOnClick) root.dataset.gallerySelecting = 'true';
    root.dataset.galleryMarqueeActive = 'true';
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
      // The drag can begin in card-grid margins; selectstart can target a Text node.
      // Limit form/tool gestures instead of requiring the pointer to start inside a card grid.
      const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
      if (!element || !surface.contains(element)) return false;
      if (
        element.closest(
          'input,textarea,select,label,form,[contenteditable=true],[data-gallery-management],[data-gallery-selection-dock],[role=dialog],[data-no-marquee]',
        )
      )
        return false;
      const button = element.closest('button');
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
      if (boundsDirty) measure();
      const hits = cards.filter((card) => intersectsSelection(rect, card.rect)).map((card) => card.id);
      const next = combineGallerySelection(gesture.base, hits, gesture.append, latest.current.limit);
      // Pointer motion within the same cards must not rerender the entire gallery every frame.
      if (next.size !== latest.current.selected.size || [...next].some((id) => !latest.current.selected.has(id)))
        latest.current.onChange(next);
      Object.assign(overlay.style, {
        display: 'block',
        left: `${rect.left - window.scrollX}px`,
        top: `${rect.top - window.scrollY}px`,
        width: `${rect.right - rect.left}px`,
        height: `${rect.bottom - rect.top}px`,
      });
    };
    const schedule = () => {
      if (gesture?.dragging && !frame) frame = requestAnimationFrame(render);
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType !== 'mouse' || !allowed(event.target)) return;
      // Include the outer gutter only alongside this selection section, below the filter panel.
      const area = root.getBoundingClientRect();
      const management = root.querySelector<HTMLElement>('[data-gallery-management]');
      const top = management?.getBoundingClientRect().top ?? area.top;
      if (event.clientY < top || event.clientY > area.bottom) return;
      event.preventDefault();
      boundsDirty = true;
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
      overlay.style.display = 'none';
    };
    const cancel = () => {
      if (gesture?.dragging) suppressClick();
      if (gesture) latest.current.onChange(gesture.base);
      gesture = null;
      cancelAnimationFrame(frame);
      frame = 0;
      overlay.style.display = 'none';
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
    surface.addEventListener('pointerdown', down, true);
    root.addEventListener('click', click, true);
    surface.addEventListener('dragstart', preventNative);
    surface.addEventListener('selectstart', preventNative);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', schedule, true);
    const invalidate = () => {
      boundsDirty = true;
      schedule();
    };
    // Document-space bounds survive scrolling. Refresh only after layout/content changes,
    // including lazy image sizing and progressive mounting, not on every pointer event.
    const resize = new ResizeObserver(invalidate);
    const observeCards = () => {
      resize.disconnect();
      resize.observe(root);
      for (const card of root.querySelectorAll('[data-gallery-selection-id]')) resize.observe(card);
      invalidate();
    };
    const observer = new MutationObserver(observeCards);
    observeCards();
    window.addEventListener('resize', invalidate);
    root.addEventListener('load', invalidate, true);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      overlay.style.display = 'none';
      delete root.dataset.gallerySelecting;
      delete root.dataset.galleryMarqueeActive;
      delete root.dataset.galleryMarqueeUntil;
      observer.disconnect();
      resize.disconnect();
      overlay.remove();
      window.removeEventListener('resize', invalidate);
      root.removeEventListener('load', invalidate, true);
      surface.removeEventListener('pointerdown', down, true);
      root.removeEventListener('click', click, true);
      surface.removeEventListener('dragstart', preventNative);
      surface.removeEventListener('selectstart', preventNative);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [enabled, selectOnClick]);
  return { rootRef, overlay: null };
}
