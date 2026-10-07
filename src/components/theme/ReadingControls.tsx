import { NumericSetting } from './NumericSetting';
import { READING_RULES, type ReadingPreferences } from './reading-preferences';
import { SettingHelp } from './SettingHelp';
import './theme-settings.css';

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
export function ReadingControls({
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
        help={{ setting: 'fontSize', lang }}
        value={value.fontSize}
        {...READING_RULES.fontSize}
        suffix="%"
        onChange={(v) => onChange('fontSize', v)}
      />
      <NumericSetting
        name={copy.lineHeight}
        help={{ setting: 'lineHeight', lang }}
        value={value.lineHeight}
        {...READING_RULES.lineHeight}
        onChange={(v) => onChange('lineHeight', v)}
      />
      {(['font', 'density', 'corners', 'transparency', 'motion'] as const).map((key, index) => (
        <div key={key} className="appearance-choice">
          <span className="setting-label">
            {copy[key]}
            <SettingHelp label={copy[key]} setting={key === 'density' ? 'readingDensity' : key} lang={lang} />
          </span>
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
        </div>
      ))}
    </div>
  );
}
