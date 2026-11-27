import { useState } from 'react';
import { studioLanguage } from './StyleGalleryGenerationFields';

/** The caller keys this control by output so an armed decision never follows selection to another image. */
export function DiscardOutputAction({ locale, disabled, discard }: { locale: string; disabled: boolean; discard: () => void }) {
  const l = studioLanguage(locale);
  const [armed, setArmed] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        className="min-h-11 rounded-lg px-3 font-semibold text-rose-700 text-sm hover:bg-rose-500/10 dark:text-rose-300"
        onClick={() => {
          if (!armed) setArmed(true);
          else {
            setArmed(false);
            discard();
          }
        }}
      >
        {armed ? l('确认丢弃这张图', 'この画像を破棄する', 'Confirm discard') : l('丢弃', '破棄', 'Discard')}
      </button>
      {armed && (
        <button type="button" className="min-h-11 rounded-lg px-3 text-sm" onClick={() => setArmed(false)}>
          {l('取消', 'キャンセル', 'Cancel')}
        </button>
      )}
    </div>
  );
}
