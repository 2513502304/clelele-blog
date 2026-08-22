import { Icon } from '@iconify/react';
import type { StyleGalleryPromptChoice } from '@lib/style-gallery-prompt-client';
import {
  groupStyleGalleryPromptsByModel,
  type StyleGalleryPromptDisclosureState,
  toggleStyleGalleryPromptModel,
} from '@lib/style-gallery-prompt-groups';
import { memo, useEffect, useMemo, useState } from 'react';

export interface StyleGalleryPromptChooserLabels {
  title: string;
  description: string;
  promptOption: string;
  unknownModel: string;
  loading: string;
  loadFailed: string;
  copy: string;
  copied: string;
  close?: string;
}

interface Props {
  prompts: StyleGalleryPromptChoice[] | null;
  failed: boolean;
  labels: StyleGalleryPromptChooserLabels;
  onRetry: () => void;
  onCopy: (prompt: StyleGalleryPromptChoice) => Promise<boolean>;
  onClose?: () => void;
  reduceMotion?: boolean | null;
}

function createInitialDisclosure(prompts: StyleGalleryPromptChoice[] | null): StyleGalleryPromptDisclosureState {
  const first = prompts?.[0];
  return {
    expandedModels: first ? new Set([first.model?.trim() ?? '']) : new Set(),
    expandedPromptIds: first ? new Set([first.id]) : new Set(),
  };
}

/**
 * 两层 Prompt 选择器只在自身维护展开状态，避免每次展开都重渲染 Gallery 的完整卡片网格。
 * 最外层统一滚动，用户可同时展开多个候选进行全文比较。
 */
function StyleGalleryPromptChooserComponent({ prompts, failed, labels, onRetry, onCopy, onClose, reduceMotion }: Props) {
  const [disclosure, setDisclosure] = useState<StyleGalleryPromptDisclosureState>(() => createInitialDisclosure(prompts));
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const promptGroups = useMemo(() => groupStyleGalleryPromptsByModel(prompts ?? []), [prompts]);

  useEffect(() => {
    setDisclosure(createInitialDisclosure(prompts));
    setCopiedPromptId(null);
  }, [prompts]);

  function toggleModel(model: string, promptIds: readonly string[]) {
    setDisclosure((current) => toggleStyleGalleryPromptModel(current, model, promptIds));
  }

  function togglePrompt(promptId: string) {
    setDisclosure((current) => {
      const expandedPromptIds = new Set(current.expandedPromptIds);
      if (expandedPromptIds.has(promptId)) expandedPromptIds.delete(promptId);
      else expandedPromptIds.add(promptId);
      return { ...current, expandedPromptIds };
    });
  }

  async function copyPrompt(prompt: StyleGalleryPromptChoice) {
    if (!(await onCopy(prompt))) return;
    setCopiedPromptId(prompt.id);
    window.setTimeout(() => setCopiedPromptId((current) => (current === prompt.id ? null : current)), 1800);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="relative shrink-0 border-border border-b px-6 pt-6 pr-14 pb-4">
        <h2 className="font-semibold text-lg leading-none tracking-tight">{labels.title}</h2>
        <p className="mt-2 text-muted-foreground text-sm">{labels.description}</p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label={labels.close}
            title={labels.close}
          >
            <Icon icon="ri:close-line" className="size-5" />
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 [scrollbar-color:hsl(var(--border))_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2">
        {!prompts && !failed && (
          <div className="flex min-h-32 items-center justify-center gap-2 text-muted-foreground text-sm">
            <Icon icon="ri:loader-4-line" className={`size-4 ${reduceMotion ? '' : 'animate-spin'}`} />
            {labels.loading}
          </div>
        )}
        {failed && (
          <button
            type="button"
            onClick={onRetry}
            className="flex min-h-32 w-full items-center justify-center gap-2 text-rose-500 text-sm"
          >
            <Icon icon="ri:refresh-line" className="size-4" />
            {labels.loadFailed}
          </button>
        )}
        {prompts && (
          <div className="space-y-5 pt-4">
            {promptGroups.map((group) => {
              const groupKey = group.model ?? '';
              const groupExpanded = disclosure.expandedModels.has(groupKey);
              return (
                <section
                  key={groupKey || '__unknown__'}
                  aria-label={group.model ?? labels.unknownModel}
                  className="overflow-hidden rounded-lg border border-border bg-background [contain:layout_paint]"
                >
                  <button
                    type="button"
                    aria-expanded={groupExpanded}
                    onClick={() =>
                      toggleModel(
                        groupKey,
                        group.prompts.map(({ prompt }) => prompt.id),
                      )
                    }
                    className="flex w-full items-center gap-2 px-4 py-3 text-left transition hover:bg-muted/60"
                  >
                    <span className="min-w-0 flex-1 truncate font-bold text-sm">{group.model ?? labels.unknownModel}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                      ×{group.prompts.length}
                    </span>
                    <Icon
                      icon={groupExpanded ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'}
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </button>
                  {groupExpanded && (
                    <div className="space-y-2 border-border border-t bg-muted/20 p-2 pl-5">
                      {group.prompts.map(({ prompt, modelIndex }) => {
                        const promptExpanded = disclosure.expandedPromptIds.has(prompt.id);
                        const promptCopied = copiedPromptId === prompt.id;
                        return (
                          <article key={prompt.id} className="overflow-hidden rounded-lg border border-border bg-background">
                            <button
                              type="button"
                              aria-expanded={promptExpanded}
                              onClick={() => togglePrompt(prompt.id)}
                              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/60"
                            >
                              <span className="min-w-0 flex-1 truncate font-bold text-sm">
                                {labels.promptOption.replace('{index}', String(modelIndex))}
                              </span>
                              <Icon
                                icon={promptExpanded ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'}
                                className="size-4 shrink-0 text-muted-foreground"
                              />
                            </button>
                            {promptExpanded && (
                              <div className="border-border border-t p-4">
                                <p className="whitespace-pre-wrap text-muted-foreground text-sm leading-6">{prompt.prompt}</p>
                                <button
                                  type="button"
                                  onClick={() => void copyPrompt(prompt)}
                                  className="mt-4 ml-auto flex h-9 min-w-24 items-center justify-center gap-2 rounded-md bg-rose-500 px-4 font-bold text-sm text-white transition hover:bg-rose-600"
                                >
                                  <Icon
                                    icon={promptCopied ? 'ri:check-line' : 'ri:file-copy-line'}
                                    className="size-4 shrink-0"
                                  />
                                  <span>{promptCopied ? labels.copied : labels.copy}</span>
                                </button>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export const StyleGalleryPromptChooser = memo(StyleGalleryPromptChooserComponent);
