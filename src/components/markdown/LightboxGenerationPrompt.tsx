import { useTranslation } from '@hooks/useTranslation';
import { useState } from 'react';

/** Each viewed image starts collapsed; wheel input belongs to the text, never the zoom canvas. */
export function LightboxGenerationPrompt({ prompt }: { prompt: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <details
      className="absolute right-20 bottom-40 left-4 z-10 max-w-2xl rounded-xl border border-white/20 bg-black/80 p-3 text-white shadow-xl backdrop-blur-md"
      data-lightbox-scroll-region
      onPointerDown={(event) => event.stopPropagation()}
    >
      <summary className="cursor-pointer text-sm">{t('gallery.generationPromptExpand')}</summary>
      <section
        data-lightbox-scroll-region
        className="mt-3 max-h-[35dvh] overflow-y-auto overscroll-contain whitespace-pre-wrap break-words pr-2 text-sm leading-relaxed"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the full prompt.
        tabIndex={0}
        aria-label={t('gallery.generationPrompt')}
      >
        {prompt}
      </section>
      <button
        type="button"
        className="mt-3 rounded-lg border border-white/30 px-3 py-2 text-sm hover:bg-white/15"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(prompt);
            setCopied(true);
            setFailed(false);
          } catch {
            setFailed(true);
          }
        }}
      >
        {copied ? t('gallery.copied') : t('gallery.generationPromptCopy')}
      </button>
      {failed && <p role="alert">{t('gallery.generationPromptCopyFailed')}</p>}
    </details>
  );
}
