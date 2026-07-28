import { Icon } from '@iconify/react';
import { useRef } from 'react';

interface Props {
  labels: {
    toolbar: string;
    previous: string;
    next: string;
    characters: string;
    animations: string;
    settings: string;
    hide: string;
    restore: string;
  };
  onPrevious: () => void;
  onNext: () => void;
  onCharacters: () => void;
  onAnimations: () => void;
  onSettings: () => void;
  onHide: () => void;
}

const buttons = [
  ['previous', 'ri:arrow-left-s-line'],
  ['next', 'ri:arrow-right-s-line'],
  ['characters', 'ri:user-smile-line'],
  ['animations', 'ri:movie-line'],
  ['settings', 'ri:settings-3-line'],
  ['hide', 'ri:eye-off-line'],
] as const;

export function Live2DControls(props: Props) {
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const suppressedTooltip = useRef<string | null>(null);
  const setTooltip = (value: string) => {
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    tooltip.textContent = value;
    if (value) tooltip.dataset.visible = 'true';
    else delete tooltip.dataset.visible;
  };
  const actions = {
    previous: props.onPrevious,
    next: props.onNext,
    characters: props.onCharacters,
    animations: props.onAnimations,
    settings: props.onSettings,
    hide: props.onHide,
  };
  return (
    <div className="live2d-controls-shell">
      <span ref={tooltipRef} className="live2d-controls-tooltip" role="tooltip" />
      <div className="live2d-controls" role="toolbar" aria-label={props.labels.toolbar}>
        {buttons.map(([key, icon]) => (
          <button
            key={key}
            type="button"
            className="live2d-icon-button"
            aria-label={props.labels[key]}
            onMouseEnter={() => {
              if (suppressedTooltip.current !== key) setTooltip(props.labels[key]);
            }}
            onMouseLeave={() => {
              suppressedTooltip.current = null;
              setTooltip('');
            }}
            onFocus={() => {
              if (suppressedTooltip.current !== key) setTooltip(props.labels[key]);
            }}
            onBlur={() => setTooltip('')}
            onClick={() => {
              suppressedTooltip.current = key;
              setTooltip('');
              actions[key]();
            }}
          >
            <Icon icon={icon} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
