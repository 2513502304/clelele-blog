import { Icon } from '@iconify/react';

interface Props {
  labels: {
    toolbar: string;
    previous: string;
    next: string;
    characters: string;
    settings: string;
    hide: string;
    restore: string;
  };
  onPrevious: () => void;
  onNext: () => void;
  onCharacters: () => void;
  onSettings: () => void;
  onHide: () => void;
  onRestore: () => void;
}

const buttons = [
  ['previous', 'ri:arrow-left-s-line'],
  ['next', 'ri:arrow-right-s-line'],
  ['characters', 'ri:user-smile-line'],
  ['settings', 'ri:settings-3-line'],
  ['restore', 'ri:map-pin-line'],
  ['hide', 'ri:eye-off-line'],
] as const;

export function Live2DControls(props: Props) {
  const actions = {
    previous: props.onPrevious,
    next: props.onNext,
    characters: props.onCharacters,
    settings: props.onSettings,
    hide: props.onHide,
    restore: props.onRestore,
  };
  return (
    <div className="live2d-controls" role="toolbar" aria-label={props.labels.toolbar}>
      {buttons.map(([key, icon]) => (
        <button
          key={key}
          type="button"
          className="live2d-icon-button"
          aria-label={props.labels[key]}
          title={props.labels[key]}
          onClick={actions[key]}
        >
          <Icon icon={icon} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
