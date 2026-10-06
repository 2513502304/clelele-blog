import { Icon } from '@iconify/react';
import { useEffect, useState } from 'react';
import { NumericSetting } from './NumericSetting';
import { sceneryCopy } from './scenery-copy';
import {
  DEFAULT_SCENERY,
  getSceneryPreferences,
  SCENERY_RULES,
  type SceneryPreferences,
  setSceneryPreferences,
} from './scenery-preferences';
import './scenery-controls.css';

// Presets affect light and color only; framing, typography and ambient effects remain independent.
const neutral = {
  imageOpacity: 100,
  mask: 40,
  maskStyle: 'uniform',
  tone: 'neutral',
  brightness: 100,
  contrast: 100,
  saturation: 100,
  blur: 0,
} as const;
const looks: (typeof neutral | Partial<SceneryPreferences>)[] = [
  neutral,
  { ...neutral, mask: 18, maskStyle: 'gradient', brightness: 110, contrast: 88, saturation: 85 },
  { ...neutral, mask: 26, maskStyle: 'gradient', tone: 'warm', contrast: 108, saturation: 88 },
  { ...neutral, mask: 32, maskStyle: 'gradient', tone: 'cool', brightness: 95, contrast: 105, saturation: 85 },
  { ...neutral, mask: 24, maskStyle: 'gradient', contrast: 115, saturation: 0 },
  { ...neutral, mask: 65, maskStyle: 'vignette', contrast: 112, saturation: 80 },
];
const effectKeys = ['effect', 'density', 'speed', 'effectOpacity'] as const;
type NumericKey = {
  [K in keyof SceneryPreferences]: SceneryPreferences[K] extends number ? K : never;
}[keyof SceneryPreferences];
type ChoiceKey = keyof typeof sceneryCopy.zh.choices;

/** Live browser preferences with presets, progressive disclosure and an actual current-cover preview. */
export function SceneryControls({ tab, lang }: { tab: 'banner' | 'effects'; lang: 'zh' | 'en' | 'ja' }) {
  const copy = sceneryCopy[lang];
  const [value, setValue] = useState(getSceneryPreferences);
  const [reduced, setReduced] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [preview, setPreview] = useState({ src: '', title: '' });
  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      setValue(getSceneryPreferences());
      setReduced(motion.matches || document.documentElement.dataset.readingMotion === 'reduced');
      setLoadFailed(document.querySelector('#ambient-effects')?.getAttribute('data-error') === 'load');
    };
    const image = document.querySelector<HTMLImageElement>('.site-banner .banner-image');
    const title = document.querySelector('.site-banner .banner-copy h1')?.cloneNode(true) as HTMLElement | undefined;
    title?.querySelectorAll('svg').forEach((icon) => {
      icon.remove();
    });
    setPreview({
      src: image?.currentSrc || image?.src || '',
      title: title?.textContent?.trim() || 'clelele',
    });
    sync();
    window.addEventListener('scenery-change', sync);
    window.addEventListener('scenery-status', sync);
    window.addEventListener('reading-change', sync);
    motion.addEventListener('change', sync);
    return () => {
      window.removeEventListener('scenery-change', sync);
      window.removeEventListener('scenery-status', sync);
      window.removeEventListener('reading-change', sync);
      motion.removeEventListener('change', sync);
    };
  }, []);
  function change(patch: Partial<SceneryPreferences>) {
    setSceneryPreferences({ ...getSceneryPreferences(), ...patch });
  }
  function reset() {
    const defaults = Object.fromEntries(
      Object.entries(DEFAULT_SCENERY).filter(
        ([key]) => effectKeys.includes(key as (typeof effectKeys)[number]) === (tab === 'effects'),
      ),
    );
    change(defaults);
  }
  function numeric(key: NumericKey, suffix = '%') {
    return (
      <NumericSetting
        key={key}
        name={copy[key]}
        value={value[key]}
        {...SCENERY_RULES[key]}
        suffix={suffix}
        onChange={(v) => change({ [key]: v })}
      />
    );
  }
  function choice(key: ChoiceKey) {
    return (
      <label className="appearance-choice" key={key}>
        <span>{copy[key]}</span>
        <select aria-label={copy[key]} value={value[key]} onChange={(e) => change({ [key]: e.currentTarget.value })}>
          {SCENERY_RULES[key].values.map((v, i) => (
            <option key={v} value={v}>
              {copy.choices[key][i]}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <div className="scenery-controls">
      {tab === 'banner' ? (
        <>
          <div className="scenery-preview" aria-hidden="true">
            {preview.src && <img className="banner-image" src={preview.src} alt="" />}
            <div className="banner-mask" />
            <div className="banner-tint" />
            <div className="banner-copy">
              <h1>{preview.title}</h1>
            </div>
            <span className="scenery-preview-label">{copy.preview}</span>
          </div>
          <p className="appearance-section-label">
            <span>{copy.looks}</span>
            <span>01 — 06</span>
          </p>
          <fieldset className="scenery-looks" aria-label={copy.looks}>
            {looks.map((look, i) => (
              <button
                type="button"
                key={copy.lookNames[i]}
                aria-pressed={Object.entries(look).every(([key, v]) => value[key as keyof SceneryPreferences] === v)}
                onClick={() => change(look)}
              >
                <span className={`scenery-look scenery-look-${i}`} aria-hidden="true">
                  <i />
                  <b>Aa</b>
                </span>
                <span>{copy.lookNames[i]}</span>
              </button>
            ))}
          </fieldset>
          <section className="scenery-group">
            <h3>
              <Icon icon="ri:sun-line" />
              {copy.image}
            </h3>
            {numeric('imageOpacity')}
            {numeric('mask')}
            {choice('maskStyle')}
            {choice('edge')}
          </section>
          <details className="scenery-group">
            <summary>
              {copy.advanced}
              <Icon icon="ri:add-line" />
            </summary>
            <div className="scenery-group-body">
              {choice('tone')}
              {numeric('brightness')}
              {numeric('contrast')}
              {numeric('saturation')}
              {numeric('blur', 'px')}
              {numeric('focusX')}
              {numeric('focusY')}
            </div>
          </details>
          <details className="scenery-group">
            <summary>
              {copy.text}
              <Icon icon="ri:add-line" />
            </summary>
            <div className="scenery-group-body">
              {numeric('textOpacity')}
              {numeric('textSize')}
              {choice('textFont')}
              {choice('textWeight')}
              {choice('textColor')}
              {numeric('textSpacing', '/100 em')}
              {numeric('textShadow')}
            </div>
          </details>
          <p className="appearance-caption">{copy.bannerHint}</p>
        </>
      ) : (
        <>
          <div className="scenery-effect-heading">
            <span>ATMOSPHERE</span>
            <h3>{copy.effects[SCENERY_RULES.effect.values.indexOf(value.effect)]}</h3>
            <p>{copy.effectHint}</p>
          </div>
          <fieldset
            className="scenery-effects"
            aria-label={lang === 'zh' ? '页面特效' : lang === 'ja' ? 'ページ効果' : 'Page effects'}
          >
            {SCENERY_RULES.effect.values.map((effect, i) => (
              <button key={effect} type="button" aria-pressed={value.effect === effect} onClick={() => change({ effect })}>
                <span className={`scenery-effect-art scenery-effect-${effect}`} aria-hidden="true">
                  <EffectMark effect={effect} />
                </span>
                <span>{copy.effects[i]}</span>
              </button>
            ))}
          </fieldset>
          {value.effect !== 'none' && (
            <div className="scenery-group">
              {numeric('density')}
              {numeric('speed')}
              {numeric('effectOpacity')}
            </div>
          )}
          {value.effect !== 'none' && reduced && (
            <output className="scenery-notice">
              <Icon icon="ri:pause-circle-line" />
              {copy.reduced}
            </output>
          )}
          {value.effect !== 'none' && loadFailed && <output className="scenery-notice">{copy.loadFailed}</output>}
        </>
      )}
      <button type="button" className="scenery-reset" onClick={reset}>
        <Icon icon="ri:restart-line" />
        {tab === 'banner' ? copy.resetBanner : copy.resetEffects}
      </button>
    </div>
  );
}

/** Inline silhouettes keep the small effect previews available without a remote icon request. */
function EffectMark({ effect }: { effect: SceneryPreferences['effect'] }) {
  return (
    <svg viewBox="0 0 80 50" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      {effect === 'none' && (
        <>
          <circle cx="40" cy="25" r="11" />
          <path d="m32 33 16-16" />
        </>
      )}
      {(effect === 'sakura' || effect === 'leaves') && (
        <g fill="currentColor" stroke="none" opacity=".8">
          <path d="M28 10C44 10 42 26 29 32C18 23 18 14 28 10Z" />
          <path d="M54 27C66 30 60 39 50 41C44 32 47 27 54 27Z" />
          <path d="M59 8C68 11 64 16 57 17C53 11 54 8 59 8Z" />
        </g>
      )}
      {effect === 'snow' && (
        <>
          <path d="M40 9v32M26 17l28 16M26 33l28-16M35 12l5 5 5-5M35 38l5-5 5 5" />
          <circle cx="19" cy="34" r="2" fill="currentColor" />
          <circle cx="64" cy="14" r="2" fill="currentColor" />
        </>
      )}
      {effect === 'rain' && <path d="m27 9-8 25m23-23-8 25m23-28-8 25m22-20-8 25" />}
      {(effect === 'fireflies' || effect === 'bokeh') && (
        <g fill="currentColor" stroke="none">
          <circle cx="28" cy="18" r={effect === 'bokeh' ? 10 : 2} opacity=".6" />
          <circle cx="52" cy="31" r={effect === 'bokeh' ? 8 : 3} opacity=".8" />
          <circle cx="61" cy="12" r="2" />
          <circle cx="18" cy="39" r="1.5" />
        </g>
      )}
      {effect === 'stars' && (
        <>
          <path d="M38 8Q38 24 51 24Q38 24 38 41Q38 24 25 24Q38 24 38 8Z" fill="currentColor" />
          <path d="m61 10 0 10m-5-5h10M19 34v6m-3-3h6" />
        </>
      )}
      {effect === 'aurora' && (
        <g opacity=".85">
          <path d="M10 36C23 30 24 10 41 15S58 29 71 10M10 40C23 34 24 14 41 19S58 33 71 14M10 44C23 38 24 18 41 23S58 37 71 18" />
        </g>
      )}
    </svg>
  );
}
