/** Keep the native thumb and painted track derived from the same sanitized DOM value.
 * Programmatic value assignments do not emit input events. Call setControlValue when
 * restoring a draft, selecting a layer, applying a preset, or refreshing playback.
 * No DOM replacement, setter patching, polling, or synthetic input events: dragging,
 * focus, undo transactions and model state remain owned by the original control.
 */
export function syncRange(input) {
  if (input?.type !== 'range') return;
  const min = input.min === '' ? 0 : Number(input.min);
  const max = input.max === '' ? 100 : Number(input.max);
  const ratio = max > min ? (input.valueAsNumber - min) / (max - min) : 0;
  const percent = (Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0)) * 100).toFixed(2) + '%';
  if (input.style.getPropertyValue('--range-progress') !== percent) input.style.setProperty('--range-progress', percent);
}

export function setControlValue(input, value) {
  input.value = String(value);
  syncRange(input);
}

export function refreshRanges(root = document) {
  syncRange(root);
  for (const input of root.querySelectorAll('input[type="range"]')) syncRange(input);
}
