import { getReusableStyleGalleryImageUrl, preloadStyleGalleryImages } from '@lib/style-gallery-image-client';
import { parseStyleGalleryImageApiPath } from '@lib/style-gallery-image-key';
import { $backgroundPagePaused } from '@store/page-activity';
import { useEffect, useRef } from 'react';

/** A single delegated listener warms one explicit zoom target, never the whole list on scroll. */
export function useGalleryLightboxIntent(enabled: boolean): void {
  const downloading = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    let focusIntent = false;
    let lastScroll = -Infinity;
    let waitingForPointerMove = false;
    const cancel = () => clearTimeout(timer);
    // Keyboard focus may scroll its target into view. That is an intentional
    // preview request; ordinary pointer hover must still cancel during scrolling.
    const onScroll = () => {
      lastScroll = performance.now();
      if (!focusIntent) {
        cancel();
        waitingForPointerMove = true;
      }
    };
    const schedule = (event: Event) => {
      if (event instanceof PointerEvent && event.pointerType !== 'mouse') return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-gallery-original]') : null;
      const source = target?.dataset.galleryOriginal;
      if ($backgroundPagePaused.get() || !target || !source || !parseStyleGalleryImageApiPath(source)) return;
      // Moving between a button's icon and label is still the same intent.
      if (event instanceof PointerEvent && event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) {
        return;
      }
      cancel();
      focusIntent = event.type === 'focusin';
      // Scrolling can put a new button under a stationary mouse and synthesize
      // pointerover. Require a quiet interval and a real move before re-arming.
      if (!focusIntent && (performance.now() - lastScroll < 180 || (waitingForPointerMove && event.type !== 'pointermove'))) {
        waitingForPointerMove = true;
        return;
      }
      waitingForPointerMove = false;
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
      if (downloading.current || document.hidden || connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? ''))
        return;
      timer = setTimeout(() => {
        if (!active || !target.isConnected || document.hidden || $backgroundPagePaused.get()) return;
        downloading.current = true;
        const url = getReusableStyleGalleryImageUrl(source, false) ?? source;
        // The existing preloader registers in-flight URLs synchronously. A click
        // joins that native request instead of starting a second progress fetch.
        void preloadStyleGalleryImages([{ source, url, priority: 'low' }]).finally(() => {
          downloading.current = false;
        });
      }, 350);
    };
    const move = (event: PointerEvent) => {
      if (waitingForPointerMove && (event.movementX || event.movementY)) schedule(event);
    };
    const leave = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-gallery-original]') : null;
      if (target && (!(event.relatedTarget instanceof Node) || !target.contains(event.relatedTarget))) cancel();
    };
    const unsubscribe = $backgroundPagePaused.subscribe((paused) => {
      if (paused) cancel();
    });
    document.addEventListener('pointerover', schedule);
    document.addEventListener('pointerout', leave);
    document.addEventListener('pointermove', move);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', cancel);
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    document.addEventListener('visibilitychange', cancel);
    return () => {
      active = false;
      unsubscribe();
      cancel();
      document.removeEventListener('pointerover', schedule);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', cancel);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('visibilitychange', cancel);
    };
  }, [enabled]);
}
