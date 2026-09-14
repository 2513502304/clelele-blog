import {
  getSelectedStyleGalleryPromptDetail,
  STYLE_GALLERY_PROMPT_SELECTED_EVENT,
  type StyleGalleryPromptSelectedDetail,
} from '@lib/style-gallery-prompt-selection';
import { useEffect, useState } from 'react';

/** The left column follows the selected right-column variant without duplicating generated prompts. */
export default function StyleGalleryOriginalPrompt({
  slug,
  initialPrompt,
  label,
}: {
  slug: string;
  initialPrompt?: string;
  label: string;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  useEffect(() => {
    const selected = getSelectedStyleGalleryPromptDetail(slug);
    if (selected) setPrompt(selected.originalPrompt);
    const update = (event: Event) => {
      const detail = (event as CustomEvent<StyleGalleryPromptSelectedDetail>).detail;
      if (detail.slug === slug) setPrompt(detail.originalPrompt);
    };
    window.addEventListener(STYLE_GALLERY_PROMPT_SELECTED_EVENT, update);
    return () => window.removeEventListener(STYLE_GALLERY_PROMPT_SELECTED_EVENT, update);
  }, [slug]);
  if (!prompt) return null;
  return (
    <section
      className="rounded-lg border border-sky-100 bg-sky-50/70 p-5 shadow-sm dark:border-sky-950/60 dark:bg-sky-950/30"
      data-gallery-original-prompt
    >
      <h2 className="font-bold text-sky-500 text-xs uppercase tracking-wider dark:text-sky-200">{label}</h2>
      <p className="mt-2 whitespace-pre-wrap text-gray-700 text-sm leading-7 dark:text-gray-200">{prompt}</p>
    </section>
  );
}
