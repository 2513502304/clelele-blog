import type { Live2DPlacementPreset } from '@lib/live2d/geometry';
import type { Live2DDisplayPolicy } from '@lib/live2d/preferences';

interface Props {
  labels: Record<string, string>;
  audioEnabled: boolean;
  displayPolicy: Live2DDisplayPolicy;
  onAudio: (enabled: boolean) => void;
  onPolicy: (policy: Live2DDisplayPolicy) => void;
  onPreset: (preset: Live2DPlacementPreset) => void;
  onNudge: (direction: 'up' | 'right' | 'down' | 'left') => void;
}

export function Live2DSettings({ labels, audioEnabled, displayPolicy, onAudio, onPolicy, onPreset, onNudge }: Props) {
  return (
    <section className="live2d-panel" aria-label={labels.settings}>
      <h2>{labels.settings}</h2>
      <label className="live2d-toggle-row">
        <span>{labels.audio}</span>
        <input type="checkbox" checked={audioEnabled} onChange={(event) => onAudio(event.currentTarget.checked)} />
      </label>
      <fieldset>
        <legend>{labels.displayPolicy}</legend>
        <label>
          <input type="radio" name="live2d-policy" checked={displayPolicy === 'smart'} onChange={() => onPolicy('smart')} />{' '}
          {labels.smart}
        </label>
        <label>
          <input
            type="radio"
            name="live2d-policy"
            checked={displayPolicy === 'always-visible'}
            onChange={() => onPolicy('always-visible')}
          />{' '}
          {labels.alwaysVisible}
        </label>
      </fieldset>
      <fieldset>
        <legend>{labels.position}</legend>
        <div className="live2d-segments">
          {(['bottom-left', 'bottom-center', 'bottom-right'] as const).map((preset) => (
            <button type="button" key={preset} onClick={() => onPreset(preset)}>
              {labels[preset]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="live2d-nudge-grid">
        <legend className="sr-only">{labels.nudge}</legend>
        <button type="button" aria-label={labels.up} onClick={() => onNudge('up')}>
          ↑
        </button>
        <button type="button" aria-label={labels.left} onClick={() => onNudge('left')}>
          ←
        </button>
        <button type="button" aria-label={labels.down} onClick={() => onNudge('down')}>
          ↓
        </button>
        <button type="button" aria-label={labels.right} onClick={() => onNudge('right')}>
          →
        </button>
      </fieldset>
    </section>
  );
}
