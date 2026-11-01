import { clampStudioViewport, type StudioViewport, zoomStudioViewport } from '@lib/live2d/studio-viewport';
import { type Dispatch, type RefObject, type SetStateAction, useEffect, useRef } from 'react';

/** Direct manipulation owns only stage input; it never reloads or advances the model. */
export function useStudioViewport<T extends StudioViewport>(
  stageRef: RefObject<HTMLDivElement | null>,
  ready: boolean,
  scene: T,
  setScene: Dispatch<SetStateAction<T>>,
) {
  const current = useRef(scene);
  current.current = scene;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !ready) return;
    let drag: { id: number; clientX: number; clientY: number; width: number; height: number; view: StudioViewport } | null =
      null;
    const update = (view: StudioViewport) => {
      current.current = { ...current.current, ...clampStudioViewport(view) };
      setScene(current.current);
    };
    const reset = () => update({ zoom: 100, x: 0, y: 0 });
    const end = () => {
      const id = drag?.id;
      drag = null;
      delete stage.dataset.dragging;
      if (id !== undefined && stage.hasPointerCapture(id)) stage.releasePointerCapture(id);
    };
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || drag) return;
      event.preventDefault();
      event.stopPropagation();
      stage.focus({ preventScroll: true });
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      drag = {
        id: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        width: rect.width,
        height: rect.height,
        view: current.current,
      };
      stage.setPointerCapture(event.pointerId);
      stage.dataset.dragging = 'true';
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      update({
        ...current.current,
        x: drag.view.x + ((event.clientX - drag.clientX) / drag.width) * 100,
        y: drag.view.y + ((event.clientY - drag.clientY) / drag.height) * 100,
      });
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== drag?.id) return;
      move(event);
      end();
    };
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === drag?.id) end();
    };
    const wheel = (event: WheelEvent) => {
      // Leave browser/trackpad page zoom intact. Wheel ownership is confined to this visible stage.
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      if (drag || !event.deltaY) return;
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      const delta = Math.max(-150, Math.min(150, event.deltaY * unit));
      update(
        zoomStudioViewport(current.current, current.current.zoom * Math.exp(-delta * 0.002), {
          x: ((event.clientX - rect.left) / rect.width - 0.5) * 100,
          y: ((event.clientY - rect.top) / rect.height - 0.5) * 100,
        }),
      );
    };
    const key = (event: KeyboardEvent) => {
      if (event.target !== stage || event.ctrlKey || event.metaKey || event.altKey || drag) return;
      const amount = event.shiftKey ? 5 : 1;
      const view = current.current;
      switch (event.key) {
        case 'ArrowLeft':
          update({ ...view, x: view.x - amount });
          break;
        case 'ArrowRight':
          update({ ...view, x: view.x + amount });
          break;
        case 'ArrowUp':
          update({ ...view, y: view.y - amount });
          break;
        case 'ArrowDown':
          update({ ...view, y: view.y + amount });
          break;
        case '+':
        case '=':
          update(zoomStudioViewport(view, view.zoom + 5));
          break;
        case '-':
          update(zoomStudioViewport(view, view.zoom - 5));
          break;
        case '0':
        case 'Home':
          reset();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    // Capture before the legacy canvas' native handlers; right-side controls remain independent.
    stage.addEventListener('pointerdown', down, true);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', cancel);
    stage.addEventListener('lostpointercapture', cancel);
    stage.addEventListener('wheel', wheel, { passive: false });
    stage.addEventListener('dblclick', reset);
    stage.addEventListener('keydown', key);
    window.addEventListener('blur', end);
    return () => {
      end();
      stage.removeEventListener('pointerdown', down, true);
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', cancel);
      stage.removeEventListener('lostpointercapture', cancel);
      stage.removeEventListener('wheel', wheel);
      stage.removeEventListener('dblclick', reset);
      stage.removeEventListener('keydown', key);
      window.removeEventListener('blur', end);
    };
  }, [stageRef, ready, setScene]);
}
