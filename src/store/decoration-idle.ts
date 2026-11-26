import { atom, onMount } from 'nanostores';
import { getSceneryPreferences } from '../components/theme/scenery-preferences';

/** An interaction deadline shared by decorative renderers. Audio playback and application timers stay independent. */
export const $decorationIdle = atom(false);
onMount($decorationIdle, () => {
  if (typeof window === 'undefined') return;
  let delay = getSceneryPreferences().idleSeconds * 1000;
  let lastInput = performance.now();
  let timer = 0;
  function check() {
    timer = 0;
    const remaining = lastInput + delay - performance.now();
    if (delay && remaining > 0) timer = window.setTimeout(check, remaining);
    else $decorationIdle.set(delay > 0);
  }
  function wake() {
    lastInput = performance.now();
    if ($decorationIdle.get()) $decorationIdle.set(false);
    // High-frequency pointer and scroll events update only the deadline.
    if (delay && !timer) timer = window.setTimeout(check, delay);
  }
  function configure() {
    const next = getSceneryPreferences().idleSeconds * 1000;
    if (next === delay) return;
    delay = next;
    clearTimeout(timer);
    timer = 0;
    wake();
  }
  const events = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'focusin', 'astro:page-load', 'visibilitychange'];
  for (const name of events) document.addEventListener(name, wake, { capture: true, passive: true });
  window.addEventListener('scenery-change', configure);
  wake();
  return () => {
    clearTimeout(timer);
    for (const name of events) document.removeEventListener(name, wake, true);
    window.removeEventListener('scenery-change', configure);
    $decorationIdle.set(false);
  };
});
