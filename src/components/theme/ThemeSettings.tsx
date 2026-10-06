import { Icon } from '@iconify/react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDraggablePanel } from '@/hooks/useDraggablePanel';
import { useTranslation } from '@/hooks/useTranslation';
import { APPEARANCES, type Appearance, resetAppearance, setAppearance } from './appearance';
import { NumericSetting } from './NumericSetting';
import {
  DEFAULT_READING,
  getReadingPreferences,
  READING_RULES,
  type ReadingPreferences,
  setReadingPreferences,
} from './reading-preferences';
import { SceneryControls } from './SceneryControls';
import './theme-settings.css';

const labels = {
  zh: {
    title: '主题与阅读',
    subtitle: '换一种心情，继续阅读',
    palette: '外观预设',
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
    close: 'テーマ設定を閉じる',
    fold: 'テーマ設定を折りたたむ',
    unfold: 'テーマ設定を開く',
    reset: '初期設定に戻す',
    hint: 'ドラッグ / Alt + 矢印で移動',
    saved: 'このブラウザーに保存',
    light: '明暗は上部の日月ボタンで切り替えます',
  },
};

/** Keep palette intent separate from reading updates while a delayed snapshot callback is pending. */
function ThemePanel({ onClose }: { onClose: () => void }) {
  const { locale } = useTranslation();
  const lang = locale === 'ja' ? 'ja' : locale === 'en' ? 'en' : 'zh';
  const text = labels[lang];
  const [appearance, select] = useState<Appearance>('original');
  const [reading, updateReading] = useState(DEFAULT_READING);
  const [tab, setTab] = useState<'palette' | 'reading' | 'banner' | 'effects'>('palette');
  const [expanded, expand] = useState(true);
  const heading = useRef<HTMLButtonElement>(null);
  const drag = useDraggablePanel();
  function choose(next: Appearance) {
    select(next);
    setAppearance(next);
  }
  function configure<K extends keyof ReadingPreferences>(key: K, value: ReadingPreferences[K]) {
    const next = { ...getReadingPreferences(), [key]: value };
    updateReading(next);
    setReadingPreferences(next);
  }
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const sync = () => {
      const root = document.documentElement;
      select((root.dataset.appearance ?? 'original') as Appearance);
      updateReading(getReadingPreferences());
    };
    sync();
    const syncReading = () => updateReading(getReadingPreferences());
    window.addEventListener('appearance-change', sync);
    window.addEventListener('reading-change', syncReading);
    return () => {
      window.removeEventListener('appearance-change', sync);
      window.removeEventListener('reading-change', syncReading);
    };
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
          ref={heading}
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
          <fieldset className="appearance-tabs" aria-label={text.title}>
            <button type="button" aria-pressed={tab === 'palette'} onClick={() => setTab('palette')}>
              {text.palette}
            </button>
            <button type="button" aria-pressed={tab === 'reading'} onClick={() => setTab('reading')}>
              {lang === 'zh' ? '阅读与界面' : lang === 'ja' ? '文字と表示' : 'Reading & layout'}
            </button>
            <button type="button" aria-pressed={tab === 'banner'} onClick={() => setTab('banner')}>
              {lang === 'zh' ? '横幅' : lang === 'ja' ? 'バナー' : 'Banner'}
            </button>
            <button type="button" aria-pressed={tab === 'effects'} onClick={() => setTab('effects')}>
              {lang === 'zh' ? '氛围' : lang === 'ja' ? '効果' : 'Effects'}
            </button>
          </fieldset>
          <section className="appearance-scroll" data-panel-scroll tabIndex={expanded ? 0 : -1} aria-label={text.palette}>
            <div hidden={tab !== 'palette'}>
              <p className="appearance-section-label">
                <span>{text.palette}</span>
                <span>01 — {APPEARANCES.length}</span>
              </p>
              <fieldset className="appearance-presets" aria-label={text.palette}>
                {APPEARANCES.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="appearance-preset"
                    aria-pressed={appearance === preset.id}
                    onClick={() => choose(preset.id)}
                  >
                    <span
                      className="appearance-swatch"
                      style={{ backgroundColor: preset.color, color: preset.ink }}
                      aria-hidden
                    >
                      <span className={['paper', 'graphite'].includes(preset.id) ? 'serif' : ''}>Aa</span>
                      <i />
                      <i />
                      <Icon icon={appearance === preset.id ? 'ri:checkbox-circle-fill' : 'ri:circle-line'} />
                    </span>
                    <span>{preset[lang]}</span>
                  </button>
                ))}
              </fieldset>
            </div>
            <div hidden={tab !== 'reading'}>
              <ReadingControls value={reading} onChange={configure} lang={lang} />
            </div>
            {(tab === 'banner' || tab === 'effects') && <SceneryControls tab={tab} lang={lang} />}
            {tab === 'reading' && <p className="appearance-caption">{text.light}</p>}
          </section>
          <footer className="appearance-footer">
            <span title={text.hint}>
              <Icon icon="ri:drag-move-2-line" />
              {text.saved}
            </span>
            <button type="button" onClick={resetAppearance}>
              {text.reset}
            </button>
          </footer>
        </div>
      </div>
    </aside>
  );
}

const readingLabels = {
  zh: {
    fontSize: '字号',
    lineHeight: '正文行距',
    font: '字体',
    density: '界面密度',
    corners: '卡片圆角',
    transparency: '控制面板',
    motion: '主题动效',
    sample: '把喜欢的事物，收进日常。',
    choices: [
      ['跟随主题', '系统黑体', '宋体 / 衬线', '等宽'],
      ['紧凑', '常规', '宽松'],
      ['利落', '圆润', '柔和'],
      ['毛玻璃', '实色'],
      ['对角线展开', '立即切换'],
    ],
  },
  en: {
    fontSize: 'Text size',
    lineHeight: 'Reading line height',
    font: 'Typeface',
    density: 'Density',
    corners: 'Card corners',
    transparency: 'Control surfaces',
    motion: 'Theme motion',
    sample: 'Keep the things you love close.',
    choices: [
      ['Theme', 'System sans', 'Serif', 'Monospace'],
      ['Compact', 'Normal', 'Spacious'],
      ['Square', 'Rounded', 'Soft'],
      ['Glass', 'Solid'],
      ['Diagonal reveal', 'Instant'],
    ],
  },
  ja: {
    fontSize: '文字サイズ',
    lineHeight: '本文の行間',
    font: '書体',
    density: '表示密度',
    corners: 'カードの角',
    transparency: 'パネル',
    motion: 'テーマの動き',
    sample: '好きなものを、日常に。',
    choices: [
      ['テーマに従う', 'ゴシック', '明朝', '等幅'],
      ['コンパクト', '標準', 'ゆったり'],
      ['角形', '丸み', '柔らか'],
      ['すりガラス', '不透明'],
      ['斜めに展開', '即時切替'],
    ],
  },
};

/** Present independently persisted reading choices using the same bounds as the pre-paint bootstrap. */
function ReadingControls({
  value,
  onChange,
  lang,
}: {
  value: ReadingPreferences;
  onChange: <K extends keyof ReadingPreferences>(key: K, value: ReadingPreferences[K]) => void;
  lang: 'zh' | 'en' | 'ja';
}) {
  const copy = readingLabels[lang];
  return (
    <div className="appearance-reading">
      <div className="appearance-specimen" aria-hidden="true">
        <span>Aa / あ / 字</span>
        <p>{copy.sample}</p>
      </div>
      <NumericSetting
        name={copy.fontSize}
        value={value.fontSize}
        {...READING_RULES.fontSize}
        suffix="%"
        onChange={(v) => onChange('fontSize', v)}
      />
      <NumericSetting
        name={copy.lineHeight}
        value={value.lineHeight}
        {...READING_RULES.lineHeight}
        onChange={(v) => onChange('lineHeight', v)}
      />
      {(['font', 'density', 'corners', 'transparency', 'motion'] as const).map((key, index) => (
        <label key={key} className="appearance-choice">
          <span>{copy[key]}</span>
          <select
            aria-label={copy[key]}
            value={value[key]}
            onChange={(event) => onChange(key, event.currentTarget.value as ReadingPreferences[typeof key])}
          >
            {READING_RULES[key].values.map((option, i) => (
              <option key={option} value={option}>
                {copy.choices[index][i]}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
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
