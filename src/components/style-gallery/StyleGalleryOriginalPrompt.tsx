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
    <section className="gallery-original-note mt-5 px-4 py-2" data-gallery-original-prompt>
      <h2 className="font-medium text-muted-foreground text-xs tracking-wide">{label}</h2>
      <p className="mt-2 whitespace-pre-wrap text-foreground text-sm leading-7">{prompt}</p>
    </section>
  );
}
