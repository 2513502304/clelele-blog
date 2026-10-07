import {
  FloatingPortal,
  safePolygon,
  useClick,
  useDismiss,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { type KeyboardEvent, useState } from 'react';
import { useFloatingUI } from '@/hooks/useFloatingUI';
import { type HelpKey, type HelpLanguage, settingHelpCopy } from './setting-help-copy';
import './setting-help.css';

/** Portal outside the scrolling/dragging panel; only an open explanation observes its position. */
export function SettingHelp({ label, setting, lang }: { label: string; setting: HelpKey; lang: HelpLanguage }) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloatingUI({ open, onOpenChange: setOpen, placement: 'top', offset: 8 });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { delay: { open: 180, close: 100 }, handleClose: safePolygon() }),
    useFocus(context),
    useClick(context),
    useDismiss(context, { ancestorScroll: true, bubbles: { escapeKey: false } }),
    useRole(context, { role: 'tooltip' }),
  ]);
  return (
    <>
      <button
        {...getReferenceProps({
          onKeyDown: (event: KeyboardEvent) => {
            // Escape dismisses help first, without closing the entire settings panel.
            if (event.key === 'Escape' && open) {
              event.stopPropagation();
              setOpen(false);
            }
            // The panel can move by keyboard without a resize/scroll event.
            if (event.altKey && event.key.startsWith('Arrow')) setOpen(false);
          },
        })}
        ref={refs.setReference}
        type="button"
        className="setting-help-trigger"
        data-setting-help={setting}
        data-panel-no-drag
        aria-label={`${label} — ?`}
      >
        ?
      </button>
      {open && (
        <FloatingPortal>
          <div
            {...getFloatingProps()}
            ref={refs.setFloating}
            style={floatingStyles}
            className="setting-help-popup"
            data-panel-no-drag
          >
            <strong>{label}</strong>
            <p>{settingHelpCopy[lang][setting]}</p>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
