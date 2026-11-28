import { generationCaption, type GenerationSettings } from '@lib/style-gallery-generation-settings';
import type { ReactNode } from 'react';
import { CopyButton } from '../markdown/shared/CopyButton';
import { GenerationDetails, studioLanguage } from './StyleGalleryGenerationFields';

/** Each inspector displays only the recipe recorded with this particular output. */
export function GenerationRecipe({
  prompt,
  settings,
  model,
  locale,
  children,
}: {
  prompt?: string;
  settings?: GenerationSettings;
  model?: string;
  locale: string;
  children?: ReactNode;
}) {
  const l = studioLanguage(locale);
  return (
    <div className="studio-review-recipe">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{l('生成提示词与参数', 'プロンプトと設定', 'Prompt and settings')}</h2>
        {prompt && <CopyButton text={prompt} className="min-h-11" showLabel />}
      </div>
      <p className="my-1 text-muted-foreground text-xs">{settings ? generationCaption(settings) : model}</p>
      {children}
      <section
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Long recipes are independently keyboard scrollable.
        tabIndex={0}
        aria-label={l('提示词和完整参数', 'プロンプトと全設定', 'Prompt and complete settings')}
        className="studio-review-scroll gallery-note-scroll overflow-y-auto overscroll-contain break-words rounded-sm text-sm leading-[1.5] focus-visible:outline-2 focus-visible:outline-primary"
      >
        {prompt && <p className="whitespace-pre-wrap">{prompt}</p>}
        {settings && <GenerationDetails settings={settings} locale={locale} inline />}
      </section>
    </div>
  );
}
