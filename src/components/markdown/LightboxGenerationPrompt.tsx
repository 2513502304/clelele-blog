import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import { useState } from 'react';

/** Image browsing starts collapsed; a deliberate prompt action can reveal the text immediately. */
export function LightboxGenerationPrompt({
  prompt,
  initiallyExpanded = false,
}: {
  prompt: string;
  initiallyExpanded?: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return (
    <details
      open={expanded}
      className="absolute right-20 bottom-40 left-4 z-10 max-w-lg overflow-hidden rounded-2xl border border-white/15 bg-zinc-950/90 text-white shadow-2xl backdrop-blur-xl"
      data-lightbox-scroll-region
      onPointerDown={(event) => event.stopPropagation()}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary
        aria-label={expanded ? t('gallery.generationPromptCollapse') : t('gallery.generationPromptExpand')}
        className="flex cursor-pointer list-none items-center gap-3 p-3.5 outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-inset [&::-webkit-details-marker]:hidden"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-300/10 text-rose-200">
          <Icon icon="ri:double-quotes-l" className="size-5" />
        </span>
        <span className="min-w-0 flex-1 font-medium text-sm">{t('gallery.generationPrompt')}</span>
        <span className="text-rose-200 text-xs">
          {expanded ? t('gallery.generationPromptCollapse') : t('gallery.generationPromptShow')}
        </span>
        <Icon icon={expanded ? 'ri:arrow-down-s-line' : 'ri:arrow-up-s-line'} className="size-4 shrink-0 text-rose-200" />
      </summary>
      <section
        data-lightbox-scroll-region
        className="mx-4 max-h-[35dvh] select-text overflow-y-auto overscroll-contain whitespace-pre-wrap break-words border-white/10 border-t py-3 pr-3 text-sm text-white/85 leading-7 [scrollbar-color:#fda4af55_transparent] [scrollbar-width:thin] focus-visible:outline-2 focus-visible:outline-rose-300"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the full prompt.
        tabIndex={0}
        aria-label={t('gallery.generationPrompt')}
      >
        {prompt}
      </section>
      <div className="border-white/10 border-t bg-white/[0.025] p-3">
        <button
          type="button"
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-rose-200/20 bg-rose-200/10 px-3 py-2 font-medium text-rose-100 text-sm transition-colors hover:bg-rose-200/20 focus-visible:outline-2 focus-visible:outline-rose-300 focus-visible:outline-offset-2"
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
          <Icon icon={copied ? 'ri:check-line' : 'ri:file-copy-line'} className="size-4 shrink-0" />
          {copied ? t('gallery.copied') : t('gallery.generationPromptCopy')}
        </button>
        {failed && (
          <p role="alert" className="mt-2 text-rose-200 text-xs">
            {t('gallery.generationPromptCopyFailed')}
          </p>
        )}
      </div>
    </details>
  );
}
