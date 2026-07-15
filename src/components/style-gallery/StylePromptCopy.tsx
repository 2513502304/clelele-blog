import { Icon } from '@iconify/react';
import { useState } from 'react';

interface StylePromptCopyProps {
  prompt: string;
  label: string;
  copyLabel: string;
  copiedLabel: string;
  className?: string;
}

export default function StylePromptCopy({ prompt, label, copyLabel, copiedLabel, className = '' }: StylePromptCopyProps) {
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div
      className={`overflow-hidden rounded-lg border border-rose-200/70 bg-white/80 shadow-sm dark:border-rose-900/40 dark:bg-gray-950/60 ${className}`}
    >
      <div className="flex min-h-14 items-center justify-between gap-3 border-rose-100 border-b bg-rose-50/55 px-5 py-2.5 dark:border-rose-950/60 dark:bg-rose-950/20">
        <p className="font-bold text-rose-500 text-sm dark:text-rose-300">{label}</p>
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
      <p className="whitespace-pre-wrap text-pretty p-5 text-gray-700 text-sm leading-8 dark:text-gray-200">{prompt}</p>
      <span className="sr-only" aria-live="polite">
        {copied ? copiedLabel : ''}
      </span>
    </div>
  );
}
