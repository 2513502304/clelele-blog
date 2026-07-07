import { Icon } from '@iconify/react';
import { useState } from 'react';

interface StylePromptCopyProps {
  prompt: string;
  className?: string;
}

export default function StylePromptCopy({ prompt, className = '' }: StylePromptCopyProps) {
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className={`relative ${className}`}>
      <div className="rounded-lg border border-rose-200/70 bg-white/80 p-5 pr-14 shadow-sm dark:border-rose-900/40 dark:bg-gray-950/60">
        <p className="whitespace-pre-wrap text-pretty text-gray-700 text-sm leading-8 dark:text-gray-200">{prompt}</p>
      </div>
      <button
        type="button"
        onClick={copyPrompt}
        className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-500 shadow-sm transition hover:-translate-y-0.5 hover:border-rose-300 hover:text-rose-600 dark:border-rose-900 dark:bg-gray-900 dark:text-rose-300"
        aria-label={copied ? 'Prompt copied' : 'Copy prompt'}
        title={copied ? 'Copied' : 'Copy prompt'}
      >
        <Icon icon={copied ? 'ri:check-line' : 'ri:file-copy-line'} className="size-4" />
      </button>
    </div>
  );
}
