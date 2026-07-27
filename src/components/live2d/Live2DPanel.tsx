import { Icon } from '@iconify/react';
import type { PropsWithChildren } from 'react';

interface Props extends PropsWithChildren {
  title: string;
  closeLabel: string;
  onClose: () => void;
}

/** Shared non-modal popover shell; focus remains in the page and outside clicks close it. */
export function Live2DPanel({ title, closeLabel, onClose, children }: Props) {
  return (
    <section className="live2d-panel" aria-label={title}>
      <header className="live2d-panel-header">
        <h2>{title}</h2>
        <button type="button" className="live2d-panel-close" aria-label={closeLabel} title={closeLabel} onClick={onClose}>
          <Icon icon="ri:close-line" aria-hidden="true" />
        </button>
      </header>
      <div className="live2d-panel-body">{children}</div>
    </section>
  );
}
