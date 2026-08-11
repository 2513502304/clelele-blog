import { ErrorBoundary, InlineErrorFallback } from '@components/common';
import { Icon } from '@iconify/react';
import { groupStyleGalleryPromptsByModel } from '@lib/style-gallery-prompt-groups';
import { selectStyleGalleryPrompt } from '@lib/style-gallery-prompt-selection';
import { cn } from '@lib/utils';
import { useMemo, useState } from 'react';
import type { StyleGalleryPromptVariant } from '@/types/style-gallery';

export interface StylePromptCopyProps {
  itemSlug: string;
  prompts: StyleGalleryPromptVariant[];
  label: string;
  copyLabel: string;
  copiedLabel: string;
  chooserLabel: string;
  promptOptionLabel: string;
  unknownModelLabel: string;
  originalPromptLabel: string;
  className?: string;
}

function StylePromptCopyContent({
  itemSlug,
  prompts,
  label,
  copyLabel,
  copiedLabel,
  chooserLabel,
  promptOptionLabel,
  unknownModelLabel,
  originalPromptLabel,
  className = '',
}: StylePromptCopyProps) {
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
    <div className={cn('space-y-5', className)}>
      <div className="overflow-hidden rounded-lg border border-rose-200/70 bg-white/80 shadow-sm dark:border-rose-900/40 dark:bg-gray-950/60">
        <div className="flex min-h-14 items-center justify-between gap-3 border-rose-100 border-b bg-rose-50/55 px-5 py-2.5 dark:border-rose-950/60 dark:bg-rose-950/20">
          <div className="flex min-w-0 items-center gap-3">
            <p className="shrink-0 font-bold text-rose-500 text-sm dark:text-rose-300">{label}</p>
            {prompts.length > 1 && (
              <select
                value={activePrompt?.id}
                onChange={(event) => {
                  const nextPromptId = event.currentTarget.value;
                  const nextPrompt = prompts.find((prompt) => prompt.id === nextPromptId);
                  setActivePromptId(nextPromptId);
                  setCopied(false);
                  if (nextPrompt) selectStyleGalleryPrompt({ slug: itemSlug, prompt: nextPrompt.prompt });
                }}
                aria-label={chooserLabel}
                className="h-9 min-w-0 max-w-64 rounded-md border border-rose-200 bg-white px-2 text-gray-700 text-xs outline-none focus:border-rose-400 dark:border-rose-900 dark:bg-gray-900 dark:text-gray-200"
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
          <button
            type="button"
            onClick={copyPrompt}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-500 shadow-sm transition hover:-translate-y-0.5 hover:border-rose-300 hover:text-rose-600 dark:border-rose-900 dark:bg-gray-900 dark:text-rose-300"
            aria-label={copied ? copiedLabel : copyLabel}
            title={copied ? copiedLabel : copyLabel}
          >
            <Icon icon={copied ? 'ri:check-line' : 'ri:file-copy-line'} className="size-4" />
          </button>
        </div>
        {activePrompt && (
          <p className="whitespace-pre-wrap text-pretty p-5 text-gray-700 text-sm leading-8 dark:text-gray-200">
            {activePrompt.prompt}
          </p>
        )}
      </div>
      {activePrompt?.originalPrompt && (
        <div className="rounded-lg border border-sky-100 bg-sky-50/70 p-5 shadow-sm dark:border-sky-950/60 dark:bg-sky-950/30">
          <p className="font-bold text-sky-500 text-xs uppercase tracking-wider dark:text-sky-200">{originalPromptLabel}</p>
          <p className="mt-2 whitespace-pre-wrap text-gray-700 text-sm leading-7 dark:text-gray-200">
            {activePrompt.originalPrompt}
          </p>
        </div>
      )}
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
