import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import { useId, useState } from 'react';
import { useDraggablePanel } from '@/hooks/useDraggablePanel';
import './lightbox-generation-prompt.css';

/** Per-image metadata: a compact glass dock becomes a bounded reader, with the exact full prompt used for copy. */
export function LightboxGenerationPrompt({
  prompt,
  platform,
  initiallyExpanded = false,
}: {
  prompt?: string;
  platform?: string;
  initiallyExpanded?: boolean;
}) {
  const { t, locale } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(initiallyExpanded && Boolean(prompt));
  const drag = useDraggablePanel();
  const bodyId = useId();
  const moveLabel =
    locale === 'zh'
      ? '拖动面板 · Alt + 方向键移动'
      : locale === 'ja'
        ? 'ドラッグ / Alt + 矢印で移動'
        : 'Drag to move · Alt + arrow keys';
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt ?? '');
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  return (
    <aside
      {...drag}
      data-generation-reader
      data-expanded={expanded}
      data-lightbox-scroll-region
      className="generation-glass"
      aria-label={t('gallery.generationPrompt')}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="generation-glass-header">
        <span className="generation-glass-mark" aria-hidden>
          <Icon icon={prompt ? 'ri:quill-pen-line' : 'ri:image-line'} />
        </span>
        <div className="generation-glass-heading">
          {/* Keep the platform readable independently of the toggle's accessible name, including images without notes. */}
          <span className="generation-glass-kicker" data-generation-platform>
            {platform || t('gallery.generationPrompt')}
          </span>
          {prompt && (
            <button
              type="button"
              className="generation-glass-toggle"
              aria-expanded={expanded}
              aria-controls={bodyId}
              aria-label={expanded ? t('gallery.generationPromptCollapse') : t('gallery.generationPromptExpand')}
              onClick={() => setExpanded(!expanded)}
            >
              <span className="generation-glass-title">
                {expanded ? t('gallery.generationPromptCollapse') : t('gallery.generationPromptShow')}{' '}
                <Icon icon={expanded ? 'ri:subtract-line' : 'ri:add-line'} />
              </span>
            </button>
          )}
        </div>
        {prompt && (
          <button
            type="button"
            className="generation-glass-quick-copy"
            hidden={expanded}
            onClick={() => void copy()}
            aria-label={t('gallery.generationPromptCopy')}
            title={t('gallery.generationPromptCopy')}
          >
            <Icon icon={copied ? 'ri:check-line' : 'ri:file-copy-line'} />
          </button>
        )}
      </div>
      <div id={bodyId} className="generation-glass-reveal" inert={!expanded} aria-hidden={!expanded}>
        <div className="generation-glass-content">
          <div className="generation-glass-rule">
            <span>PROMPT</span>
            <span>{prompt?.length.toLocaleString()}</span>
          </div>
          <section
            data-prompt-text
            data-lightbox-scroll-region
            className="generation-glass-text"
            tabIndex={expanded ? 0 : -1}
            aria-label={t('gallery.generationPrompt')}
          >
            {prompt}
          </section>
          <footer className="generation-glass-footer">
            <span title={moveLabel}>
              <Icon icon="ri:drag-move-2-line" />
            </span>
            <button type="button" onClick={() => void copy()} aria-label={t('gallery.generationPromptCopy')}>
              <Icon icon={copied ? 'ri:check-line' : 'ri:file-copy-line'} />
              {copied ? t('gallery.copied') : t('gallery.generationPromptCopy')}
            </button>
          </footer>
        </div>
      </div>
      {failed && (
        <p role="alert" className="px-4 pb-3 text-rose-100 text-xs">
          {t('gallery.generationPromptCopyFailed')}
        </p>
      )}
      <output className="sr-only">{copied ? t('gallery.copied') : ''}</output>
    </aside>
  );
}
