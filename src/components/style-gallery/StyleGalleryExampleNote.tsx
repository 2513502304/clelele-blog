import { Icon } from '@iconify/react';
import { defaultLocale, isLocaleSupported } from '@/i18n/config';
import { t } from '@/i18n/utils';

/** Keep a keyboard-scrollable preview beside the separate full-prompt Lightbox launcher. */
export function StyleGalleryExampleNote({
  note,
  locale,
  rows,
  onOpen,
}: {
  note: string;
  locale: string;
  rows: 3 | 5;
  onOpen: () => void;
}) {
  const language = isLocaleSupported(locale) ? locale : defaultLocale;
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={t(language, 'gallery.generationPromptExpand')}
        className="group mb-2 flex min-h-7 w-full items-center justify-between gap-2 rounded-sm text-left text-muted-foreground text-xs transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-4"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Icon icon="ri:double-quotes-l" className="size-3.5 text-primary/75" />
          {t(language, 'gallery.generationPrompt')}
        </span>
        <Icon
          icon="ri:arrow-right-up-line"
          className="size-4 shrink-0 transition-transform motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5"
        />
      </button>
      <section
        data-example-note
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Independent overflow needs keyboard scrolling in every browser.
        tabIndex={0}
        aria-label={t(language, 'gallery.generationPrompt')}
        // A smaller viewport must not truncate the prompt or remove wheel/keyboard access.
        className={`gallery-note-scroll whitespace-pre-wrap break-words text-foreground/75 text-xs leading-5 ${rows === 3 ? 'h-[3.75rem]' : 'h-[6.25rem]'}`}
      >
        {note}
      </section>
    </div>
  );
}
