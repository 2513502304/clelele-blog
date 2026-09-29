import { Icon } from '@iconify/react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDraggablePanel } from '@/hooks/useDraggablePanel';
import { useTranslation } from '@/hooks/useTranslation';
import { APPEARANCES, type Appearance, setAppearance, type TextSize } from './appearance';
import './theme-settings.css';

const labels = {
  zh: {
    title: '主题与阅读',
    subtitle: '换一种心情，继续阅读',
    palette: '外观预设',
    size: '文字大小',
    sizes: ['标准', '舒适', '大字'],
    close: '关闭主题设置',
    fold: '折叠主题设置',
    unfold: '展开主题设置',
    reset: '恢复默认',
    hint: '拖动面板 · Alt + 方向键移动',
    saved: '仅保存在此浏览器',
    light: '明暗模式仍由顶部日月按钮控制',
  },
  en: {
    title: 'Appearance',
    subtitle: 'A different mood, the same place',
    palette: 'Color palette',
    size: 'Text size',
    sizes: ['Standard', 'Comfort', 'Large'],
    close: 'Close appearance settings',
    fold: 'Collapse appearance settings',
    unfold: 'Expand appearance settings',
    reset: 'Reset',
    hint: 'Drag · Alt + arrows to move',
    saved: 'Saved in this browser',
    light: 'Use the sun/moon button for light or dark mode',
  },
  ja: {
    title: 'テーマと文字',
    subtitle: '気分を変えて、読みつづける',
    palette: 'カラーテーマ',
    size: '文字サイズ',
    sizes: ['標準', 'ゆったり', '大きめ'],
    close: 'テーマ設定を閉じる',
    fold: 'テーマ設定を折りたたむ',
    unfold: 'テーマ設定を開く',
    reset: '初期設定に戻す',
    hint: 'ドラッグ / Alt + 矢印で移動',
    saved: 'このブラウザーに保存',
    light: '明暗は上部の日月ボタンで切り替えます',
  },
};

function ThemePanel({ onClose }: { onClose: () => void }) {
  const { locale } = useTranslation();
  const lang = locale === 'ja' ? 'ja' : locale === 'en' ? 'en' : 'zh';
  const text = labels[lang];
  const [appearance, select] = useState<Appearance>('original');
  const [size, resize] = useState<TextSize>('standard');
  const [expanded, expand] = useState(true);
  const drag = useDraggablePanel();
  useEffect(() => {
    const sync = () => {
      const root = document.documentElement;
      select((root.dataset.appearance ?? 'original') as Appearance);
      resize((root.dataset.textSize ?? 'standard') as TextSize);
    };
    sync();
    window.addEventListener('appearance-change', sync);
    return () => window.removeEventListener('appearance-change', sync);
  }, []);
  return (
    <aside
      {...drag}
      className="appearance-panel"
      data-expanded={expanded}
      aria-label={text.title}
      data-live2d-exclusion
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        } else drag.onKeyDown(event);
      }}
    >
      <header className="appearance-header">
        <span className="appearance-emblem" aria-hidden>
          <Icon icon="ri:palette-line" />
        </span>
        <button
          type="button"
          className="appearance-heading"
          onClick={() => expand(!expanded)}
          aria-expanded={expanded}
          aria-controls="appearance-options"
          aria-label={expanded ? text.fold : text.unfold}
        >
          <strong>{text.title}</strong>
          <span>{text.subtitle}</span>
        </button>
        <button type="button" className="appearance-icon" onClick={onClose} aria-label={text.close}>
          <Icon icon="ri:close-line" />
        </button>
      </header>
      <div className="appearance-reveal" id="appearance-options" inert={!expanded} aria-hidden={!expanded}>
        <div className="appearance-content">
          <section className="appearance-scroll" data-panel-scroll tabIndex={expanded ? 0 : -1} aria-label={text.palette}>
            <p className="appearance-section-label">
              <span>{text.palette}</span>
              <span>01 — 10</span>
            </p>
            <fieldset className="appearance-presets" aria-label={text.palette}>
              {APPEARANCES.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="appearance-preset"
                  aria-pressed={appearance === preset.id}
                  onClick={() => setAppearance(preset.id, size)}
                >
                  <span className="appearance-swatch" style={{ backgroundColor: preset.color, color: preset.ink }} aria-hidden>
                    <span className={['paper', 'graphite'].includes(preset.id) ? 'serif' : ''}>Aa</span>
                    <i />
                    <i />
                    <Icon icon={appearance === preset.id ? 'ri:checkbox-circle-fill' : 'ri:circle-line'} />
                  </span>
                  <span>{preset[lang]}</span>
                </button>
              ))}
            </fieldset>
            <p className="appearance-section-label">{text.size}</p>
            <fieldset className="appearance-sizes" aria-label={text.size}>
              {(['standard', 'comfort', 'large'] as const).map((value, index) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={size === value}
                  onClick={() => setAppearance(appearance, value, false)}
                >
                  <span style={{ fontSize: 14 + index * 3 }}>Aa</span>
                  {text.sizes[index]}
                </button>
              ))}
            </fieldset>
            <p className="appearance-caption">{text.light}</p>
          </section>
          <footer className="appearance-footer">
            <span title={text.hint}>
              <Icon icon="ri:drag-move-2-line" />
              {text.saved}
            </span>
            <button type="button" onClick={() => setAppearance('original', 'standard')}>
              {text.reset}
            </button>
          </footer>
        </div>
      </div>
    </aside>
  );
}

/** Portal the panel out of the animated toolbar so its fixed-position drag coordinates remain viewport-relative. */
export default function ThemeSettings() {
  const { locale } = useTranslation();
  const text = labels[locale === 'ja' ? 'ja' : locale === 'en' ? 'en' : 'zh'];
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="glass-surface glass-float rounded-full p-2"
        aria-label={text.title}
        title={text.title}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-appearance-toggle
      >
        <Icon icon="ri:palette-line" className="h-5 w-5" />
      </button>
      {open &&
        createPortal(
          <ThemePanel
            onClose={() => {
              setOpen(false);
              document.querySelector<HTMLButtonElement>('[data-appearance-toggle]')?.focus();
            }}
          />,
          document.body,
        )}
    </>
  );
}
