import { Live2DPanel } from '@components/live2d/Live2DPanel';
import { Icon } from '@iconify/react';
import type { Live2DPlacement, Live2DPlacementPreset } from '@lib/live2d/geometry';
import type { Live2DDisplayPolicy } from '@lib/live2d/preferences';

interface Props {
  labels: Record<string, string>;
  audioEnabled: boolean;
  pointerTrackingEnabled: boolean;
  displayPolicy: Live2DDisplayPolicy;
  placement: Live2DPlacement;
  onAudio: (enabled: boolean) => void;
  onPointerTracking: (enabled: boolean) => void;
  onPolicy: (policy: Live2DDisplayPolicy) => void;
  onPreset: (preset: Live2DPlacementPreset) => void;
  onClose: () => void;
}

const presets = [
  ['bottom-left', 'ri:align-left'],
  ['bottom-center', 'ri:align-center'],
  ['bottom-right', 'ri:align-right'],
] as const;

export function Live2DSettings({
  labels,
  audioEnabled,
  pointerTrackingEnabled,
  displayPolicy,
  placement,
  onAudio,
  onPointerTracking,
  onPolicy,
  onPreset,
  onClose,
}: Props) {
  return (
    <Live2DPanel title={labels.settings} closeLabel={labels.close} onClose={onClose}>
      <div className="live2d-setting-row">
        <div>
          <strong>{labels.audio}</strong>
          <small>{labels.audioDescription}</small>
        </div>
        <button
          type="button"
          className="live2d-switch"
          role="switch"
          aria-checked={audioEnabled}
          aria-label={labels.audio}
          onClick={() => onAudio(!audioEnabled)}
        >
          <span />
        </button>
      </div>

      <div className="live2d-setting-row">
        <div>
          <strong>{labels.pointerTracking}</strong>
          <small>{labels.pointerTrackingDescription}</small>
        </div>
        <button
          type="button"
          className="live2d-switch"
          role="switch"
          aria-checked={pointerTrackingEnabled}
          aria-label={labels.pointerTracking}
          onClick={() => onPointerTracking(!pointerTrackingEnabled)}
        >
          <span />
        </button>
      </div>

      <fieldset className="live2d-setting-group">
        <legend>{labels.displayPolicy}</legend>
        <div className="live2d-segmented">
          {(['smart', 'alwaysVisible'] as const).map((key) => {
            const value = key === 'smart' ? 'smart' : 'always-visible';
            return (
              <button type="button" key={key} aria-pressed={displayPolicy === value} onClick={() => onPolicy(value)}>
                {labels[key]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="live2d-setting-group">
        <legend>{labels.position}</legend>
        <div className="live2d-position-grid">
          {presets.map(([preset, icon]) => (
            <button
              type="button"
              key={preset}
              aria-pressed={placement.kind === 'preset' && placement.preset === preset}
              onClick={() => onPreset(preset)}
            >
              <Icon icon={icon} aria-hidden="true" />
              <span>{labels[preset]}</span>
            </button>
          ))}
        </div>
      </fieldset>
    </Live2DPanel>
  );
}
