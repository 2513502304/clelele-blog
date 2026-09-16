import { useEffect, useRef } from 'react';

/** Lock the actual page root while allowing the active dialog body to scroll. */
export function useGalleryDialogScrollLock(open: boolean) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // This site's scroll root is html; locking only body allows wheel chaining behind Radix dialogs.
    const root = document.documentElement;
    const overflow = root.style.getPropertyValue('overflow');
    const priority = root.style.getPropertyPriority('overflow');
    root.style.setProperty('overflow', 'hidden', 'important');
    const containWheel = (event: WheelEvent) => {
      let node = event.target instanceof HTMLElement ? event.target : null;
      if (!node || !dialogRef.current?.contains(node)) return;
      while (node && node !== dialogRef.current) {
        const scrollable = /auto|scroll/.test(getComputedStyle(node).overflowY);
        if (
          scrollable &&
          ((event.deltaY < 0 && node.scrollTop > 0) ||
            (event.deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1))
        )
          return;
        node = node.parentElement;
      }
      event.preventDefault();
    };
    document.addEventListener('wheel', containWheel, { passive: false });
    return () => {
      root.style.setProperty('overflow', overflow, priority);
      document.removeEventListener('wheel', containWheel);
    };
  }, [open]);
  return dialogRef;
}
