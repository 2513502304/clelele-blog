import { type PointerEventHandler, useCallback, useRef } from 'react';

const CLICK_DISTANCE_PX = 6;

interface BackdropPointer {
  pointerId: number;
  startX: number;
  startY: number;
}

/** 只把完整发生在背景上的短按视为关闭，避免图片拖拽释放到背景时误关 popup。 */
export function useBackdropClickDismiss(onDismiss: () => void): {
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
} {
  const pointerRef = useRef<BackdropPointer | null>(null);

  const onPointerDown = useCallback<PointerEventHandler<HTMLDivElement>>((event) => {
    pointerRef.current =
      event.target === event.currentTarget
        ? { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY }
        : null;
  }, []);

  const onPointerUp = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      const pointer = pointerRef.current;
      pointerRef.current = null;
      if (!pointer || pointer.pointerId !== event.pointerId || event.target !== event.currentTarget) return;
      if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) <= CLICK_DISTANCE_PX) onDismiss();
    },
    [onDismiss],
  );

  const onPointerCancel = useCallback<PointerEventHandler<HTMLDivElement>>(() => {
    pointerRef.current = null;
  }, []);

  return { onPointerDown, onPointerUp, onPointerCancel };
}
