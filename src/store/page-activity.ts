import { atom, computed, onMount } from 'nanostores';
import { $activeModal } from './modal';

const pageHidden = atom(false);
onMount(pageHidden, () => {
  if (typeof document === 'undefined') return;
  const sync = () => pageHidden.set(document.hidden);
  sync();
  document.addEventListener('visibilitychange', sync);
  return () => document.removeEventListener('visibilitychange', sync);
});

const overlays = atom<ReadonlyMap<symbol, boolean>>(new Map());

/** Track independent/nested Radix dialogs without releasing a parent's suspension early. */
export function registerPageOverlay(keepLive2DActive = false): () => void {
  const token = Symbol('page-overlay');
  overlays.set(new Map(overlays.get()).set(token, keepLive2DActive));
  return () => {
    const next = new Map(overlays.get());
    next.delete(token);
    overlays.set(next);
  };
}

/** Page decoration and speculative work can wait while a modal owns interaction. */
export const $backgroundPagePaused = computed(
  [$activeModal, overlays, pageHidden],
  (modal, dialogs, hidden) => hidden || modal.type !== null || dialogs.size > 0,
);

/** The studio is the active Live2D surface; only other dialogs should freeze its renderer. */
export const $backgroundLive2DPaused = computed(
  [$activeModal, overlays, pageHidden],
  (modal, dialogs, hidden) =>
    hidden || (modal.type !== null && modal.type !== 'live2dStudio') || [...dialogs.values()].some((keepActive) => !keepActive),
);
