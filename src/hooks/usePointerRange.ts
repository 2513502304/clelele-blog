import { type PointerEvent, useRef } from 'react';
import { getRangeValueAtPointer } from '@/lib/range-input';

/** Explicit capture, as used by media controls, keeps controlled ranges draggable outside their native thumb. */
export function usePointerRange(onValue: (value: number) => void) {
  const pointer = useRef<number | null>(null);
  const sample = (event: PointerEvent<HTMLInputElement>) => {
    const value = getRangeValueAtPointer(event.currentTarget, event.clientX);
    event.currentTarget.value = String(value);
    onValue(value);
  };
  return {
    onInput: (event: React.FormEvent<HTMLInputElement>) => {
      if (pointer.current === null) onValue(event.currentTarget.valueAsNumber);
    },
    // Run before draggable panels stop the native bubbling event at their boundary.
    onPointerDownCapture: (event: PointerEvent<HTMLInputElement>) => {
      if (!event.isPrimary || event.button !== 0 || event.currentTarget.disabled) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      pointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      sample(event);
    },
    onPointerMove: (event: PointerEvent<HTMLInputElement>) => {
      if (pointer.current === event.pointerId) sample(event);
    },
    onPointerUp: (event: PointerEvent<HTMLInputElement>) => {
      if (pointer.current !== event.pointerId) return;
      sample(event);
      pointer.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: () => {
      pointer.current = null;
    },
    onLostPointerCapture: () => {
      pointer.current = null;
    },
  };
}
