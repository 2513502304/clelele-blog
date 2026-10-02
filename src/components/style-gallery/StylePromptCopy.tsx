import { ErrorBoundary, InlineErrorFallback } from '@components/common';
import { Icon } from '@iconify/react';
import { publishStyleGalleryPromptChoices } from '@lib/style-gallery-prompt-client';
import { groupStyleGalleryPromptsByModel } from '@lib/style-gallery-prompt-groups';
import { selectStyleGalleryPrompt } from '@lib/style-gallery-prompt-selection';
import { cn } from '@lib/utils';
import { useMemo, useState } from 'react';
import type { StyleGalleryPromptVariant } from '@/types/style-gallery';
import StyleGalleryCuration from './StyleGalleryCuration';

export interface StylePromptCopyProps {
  itemSlug: string;
  locale?: string;
  promptRevision: string;
  prompts: StyleGalleryPromptVariant[];
  label: string;
  copyLabel: string;
  copiedLabel: string;
  chooserLabel: string;
  promptOptionLabel: string;
  unknownModelLabel: string;
  className?: string;
}

/** Keep variant selection, editing and full-text copying bound to the same prompt, independent of its presentation. */
function StylePromptCopyContent({
  itemSlug,
  prompts: initialPrompts,
  locale = 'zh',
  promptRevision,
  label,
  copyLabel,
  copiedLabel,
  chooserLabel,
  promptOptionLabel,
  unknownModelLabel,
  className = '',
}: StylePromptCopyProps) {
  const [prompts, setPrompts] = useState(initialPrompts);
  const [activePromptId, setActivePromptId] = useState(prompts[0]?.id ?? '');
  const [copied, setCopied] = useState(false);
  const activePrompt = prompts.find((prompt) => prompt.id === activePromptId) ?? prompts[0];
  const promptGroups = useMemo(() => groupStyleGalleryPromptsByModel(prompts), [prompts]);

  async function copyPrompt() {
    if (!activePrompt) return;
    try {
      await navigator.clipboard.writeText(activePrompt.prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      console.error('Failed to copy prompt:', error);
    }
  }

  return (
    // The live region is out of flow; sibling spacing would add an invisible gap below the painted card.
    <div className={cn('relative', className)}>
      <div className="gallery-prompt-sheet overflow-hidden rounded-xl">
        <div className="gallery-prompt-heading flex min-h-14 flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <p className="flex shrink-0 items-center gap-2 font-bold text-foreground text-sm">
              <Icon icon="ri:double-quotes-l" className="size-4 text-primary" aria-hidden="true" />
              {label}
            </p>
            {activePrompt && (
              <span className="max-w-44 truncate rounded-full bg-primary/8 px-2.5 py-1 font-medium text-primary text-xs">
                {activePrompt.model?.trim() || unknownModelLabel}
              </span>
            )}
            {prompts.length > 1 && (
              <select
                value={activePrompt?.id}
                onChange={(event) => {
                  const nextPromptId = event.currentTarget.value;
                  const nextPrompt = prompts.find((prompt) => prompt.id === nextPromptId);
                  setActivePromptId(nextPromptId);
                  setCopied(false);
                  if (nextPrompt)
                    selectStyleGalleryPrompt({
                      slug: itemSlug,
                      prompt: nextPrompt.prompt,
                      originalPrompt: nextPrompt.originalPrompt,
                    });
                }}
                aria-label={chooserLabel}
                className="h-9 min-w-0 max-w-64 rounded-md border border-rose-200 bg-card px-2 text-gray-700 text-xs outline-none focus:border-rose-400 dark:border-rose-900 dark:text-gray-200"
              >
                {promptGroups.map((group) => (
                  <optgroup key={group.model ?? '__unknown__'} label={group.model ?? unknownModelLabel}>
                    {group.prompts.map(({ prompt, modelIndex }) => (
                      <option key={prompt.id} value={prompt.id}>
                        {promptOptionLabel.replace('{index}', String(modelIndex))}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StyleGalleryCuration
              locale={locale}
              slug={itemSlug}
              variant={activePrompt}
              onSaved={(updated, id) => {
                publishStyleGalleryPromptChoices(itemSlug, promptRevision, updated);
                setPrompts(updated);
                setActivePromptId(id);
                setCopied(false);
                const next = updated.find((prompt) => prompt.id === id);
                if (next)
                  selectStyleGalleryPrompt({ slug: itemSlug, prompt: next.prompt, originalPrompt: next.originalPrompt });
              }}
            />
            <button
              type="button"
              onClick={copyPrompt}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-card text-rose-500 shadow-sm transition hover:-translate-y-0.5 hover:border-rose-300 hover:text-rose-600 dark:border-rose-900 dark:text-rose-300"
              aria-label={copied ? copiedLabel : copyLabel}
              title={copied ? copiedLabel : copyLabel}
            >
              <Icon icon={copied ? 'ri:check-line' : 'ri:file-copy-line'} className="size-4" />
            </button>
          </div>
        </div>
        {activePrompt && (
          <p className="gallery-prompt-body whitespace-pre-wrap text-pretty p-5 text-foreground text-sm leading-8">
            {activePrompt.prompt}
          </p>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? copiedLabel : ''}
      </span>
    </div>
  );
}

/** 详情页 prompt 选择与复制失败时保留局部重试入口，不影响原图和 Sub-gallery。 */
export default function StylePromptCopy(props: StylePromptCopyProps) {
  return (
    <ErrorBoundary FallbackComponent={InlineErrorFallback}>
      <StylePromptCopyContent {...props} />
    </ErrorBoundary>
  );
}
