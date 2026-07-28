import { Live2DPanel } from '@components/live2d/Live2DPanel';
import { Icon } from '@iconify/react';
import type { Live2DEffects } from '@lib/live2d/preferences';
import { useMemo } from 'react';

interface MotionOption {
  value: string;
  label: string;
}

const RANDOM_OPTION_VALUE = '__live2d_random__';

interface Props {
  labels: Record<string, string>;
  motions: Record<string, string[]>;
  expressions: string[];
  selectedMotion: string;
  selectedExpression: string;
  paused: boolean;
  effects: Live2DEffects;
  onPlayMotion: (group: string, index: number) => void;
  onResetMotion: () => void;
  onExpression: (expression?: string) => void;
  onPause: () => void;
  onEffect: (effect: keyof Live2DEffects, enabled: boolean) => void;
  onScreenshot: () => void;
  onClose: () => void;
}

function motionValue(group: string, index: number): string {
  return `${group}\u0000${index}`;
}

/** Compact visitor controls for model-authored motions and expressions. */
export function Live2DAnimationPanel({
  labels,
  motions,
  expressions,
  selectedMotion,
  selectedExpression,
  paused,
  effects,
  onPlayMotion,
  onResetMotion,
  onExpression,
  onPause,
  onEffect,
  onScreenshot,
  onClose,
}: Props) {
  const motionOptions = useMemo<MotionOption[]>(
    () =>
      Object.entries(motions).flatMap(([group, files]) =>
        files.map((file, index) => ({
          value: motionValue(group, index),
          label: files.length > 1 ? `${group} ${index + 1}` : group || file,
        })),
      ),
    [motions],
  );
  const selectMotion = (value: string) => {
    if (!value) {
      onResetMotion();
      return;
    }
    if (value === RANDOM_OPTION_VALUE) {
      selectMotion(motionOptions[Math.floor(Math.random() * motionOptions.length)].value);
      return;
    }
    const [group, rawIndex] = value.split('\u0000');
    const index = Number(rawIndex);
    if (group && Number.isInteger(index)) onPlayMotion(group, index);
  };
  const selectExpression = (value: string) => {
    if (!value) {
      onExpression(undefined);
      return;
    }
    if (value === RANDOM_OPTION_VALUE) {
      onExpression(expressions[Math.floor(Math.random() * expressions.length)]);
      return;
    }
    onExpression(value);
  };

  return (
    <Live2DPanel title={labels.animations} closeLabel={labels.close} onClose={onClose}>
      <div className="live2d-action-strip" role="toolbar" aria-label={labels.playbackTools}>
        <button type="button" aria-pressed={paused} onClick={onPause} title={paused ? labels.resume : labels.pause}>
          <Icon icon={paused ? 'ri:play-fill' : 'ri:pause-fill'} aria-hidden="true" />
          <span>{paused ? labels.resume : labels.pause}</span>
        </button>
        <button type="button" onClick={onScreenshot} title={labels.screenshot}>
          <Icon icon="ri:camera-line" aria-hidden="true" />
          <span>{labels.screenshot}</span>
        </button>
      </div>

      <label className="live2d-select-field">
        <span>{labels.motion}</span>
        <select
          value={selectedMotion}
          disabled={motionOptions.length === 0 || paused}
          onChange={(event) => selectMotion(event.currentTarget.value)}
        >
          <option value="">{motionOptions.length === 0 ? labels.unavailable : labels.defaultMotion}</option>
          {motionOptions.length > 1 && <option value={RANDOM_OPTION_VALUE}>{labels.randomMotion}</option>}
          {motionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="live2d-select-field">
        <span>{labels.expression}</span>
        <select
          value={selectedExpression}
          disabled={expressions.length === 0 || paused}
          onChange={(event) => selectExpression(event.currentTarget.value)}
        >
          <option value="">{expressions.length === 0 ? labels.unavailable : labels.defaultExpression}</option>
          {expressions.length > 1 && <option value={RANDOM_OPTION_VALUE}>{labels.randomExpression}</option>}
          {expressions.map((expression) => (
            <option key={expression} value={expression}>
              {expression}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="live2d-effect-grid" disabled={paused}>
        <legend>{labels.automaticEffects}</legend>
        {(['sway', 'breathe', 'blink'] as const).map((effect) => (
          <div className="live2d-effect-row" key={effect}>
            <span>{labels[effect]}</span>
            <button
              type="button"
              className="live2d-switch"
              role="switch"
              aria-checked={effects[effect]}
              aria-label={labels[effect]}
              onClick={() => onEffect(effect, !effects[effect])}
            >
              <span />
            </button>
          </div>
        ))}
      </fieldset>
    </Live2DPanel>
  );
}
