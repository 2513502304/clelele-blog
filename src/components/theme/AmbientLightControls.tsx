import { Icon } from '@iconify/react';
import { NumericSetting } from './NumericSetting';
import { SettingHelp } from './SettingHelp';
import { sceneryCopy } from './scenery-copy';
import { SCENERY_RULES, type SceneryPreferences } from './scenery-preferences';

/** Static projection recipes never change the cover, palette, typography or particle preferences. */
const looks = [
  {
    label: 'ambientSoft',
    values: { lightOpacity: 55, lightBlur: 65, lightSpread: 45, lightSaturation: 85, lightThemeBlend: 25, lightSurface: 60 },
  },
  {
    label: 'ambientImmersive',
    values: { lightOpacity: 90, lightBlur: 35, lightSpread: 55, lightSaturation: 100, lightThemeBlend: 5, lightSurface: 25 },
  },
  {
    label: 'ambientVivid',
    values: { lightOpacity: 100, lightBlur: 25, lightSpread: 85, lightSaturation: 135, lightThemeBlend: 0, lightSurface: 15 },
  },
] as const;
type LightNumber = {
  [K in keyof SceneryPreferences]: K extends `light${string}` ? (SceneryPreferences[K] extends number ? K : never) : never;
}[keyof SceneryPreferences];

/** Keep frequently used controls visible and disclose the independent projection/surface settings in place. */
export function AmbientLightControls({
  value,
  change,
  lang,
  image,
}: {
  value: SceneryPreferences;
  change: (patch: Partial<SceneryPreferences>) => void;
  lang: 'zh' | 'en' | 'ja';
  image: string;
}) {
  const copy = sceneryCopy[lang];
  const numeric = (key: LightNumber) => (
    <NumericSetting
      key={key}
      name={copy[key]}
      help={{ setting: key, lang }}
      value={value[key]}
      {...SCENERY_RULES[key]}
      suffix="%"
      onChange={(v) => change({ [key]: v })}
    />
  );
  return (
    <section className="scenery-group scenery-light-group">
      <h3>
        <Icon icon="ri:rainbow-line" />
        {copy.ambientHeading}
        <SettingHelp label={copy.ambientLight} setting="ambientLight" lang={lang} />
      </h3>
      <p className="appearance-caption">{copy.ambientHint}</p>
      <fieldset className="scenery-light-modes" aria-label={copy.ambientLight}>
        {SCENERY_RULES.ambientLight.values.map((mode, i) => (
          <button
            key={mode}
            type="button"
            aria-pressed={value.ambientLight === mode}
            onClick={() => change({ ambientLight: mode })}
          >
            <span className={`scenery-light-art scenery-light-${mode}`} aria-hidden="true">
              {image && <img src={image} alt="" />}
              <i />
            </span>
            <span>{copy.choices.ambientLight[i]}</span>
          </button>
        ))}
      </fieldset>
      {value.ambientLight !== 'off' && (
        <>
          <p className="appearance-section-label">
            <span className="setting-label">
              {copy.ambientLooks}
              <SettingHelp label={copy.ambientLooks} setting="ambientLooks" lang={lang} />
            </span>
          </p>
          <fieldset className="ambient-recipes" aria-label={copy.ambientLooks}>
            {looks.map(({ label, values }, i) => (
              <button
                key={label}
                type="button"
                aria-pressed={
                  value.ambientLight === 'wash' &&
                  value.lightDirection === 'all' &&
                  value.lightBrightness === 100 &&
                  value.lightContrast === 100 &&
                  value.lightFeather === 30 &&
                  value.lightTextShadow === 20 &&
                  Object.entries(values).every(([k, v]) => value[k as keyof SceneryPreferences] === v)
                }
                onClick={() =>
                  change({
                    ...values,
                    ambientLight: 'wash',
                    lightDirection: 'all',
                    lightBrightness: 100,
                    lightContrast: 100,
                    lightFeather: 30,
                    lightTextShadow: 20,
                  })
                }
              >
                <span aria-hidden="true">0{i + 1}</span>
                {copy[label]}
              </button>
            ))}
          </fieldset>
          {numeric('lightOpacity')}
          {numeric('lightBlur')}
          <details className="scenery-group">
            <summary>
              {copy.ambientProjection}
              <Icon icon="ri:add-line" />
            </summary>
            <div className="scenery-group-body">
              {numeric('lightSpread')}
              {numeric('lightBrightness')}
              {numeric('lightContrast')}
              {numeric('lightSaturation')}
              {numeric('lightThemeBlend')}
              {numeric('lightFeather')}
              <div className="appearance-choice">
                <span className="setting-label">
                  {copy.lightDirection}
                  <SettingHelp label={copy.lightDirection} setting="lightDirection" lang={lang} />
                </span>
                <select
                  aria-label={copy.lightDirection}
                  value={value.lightDirection}
                  onChange={(e) => change({ lightDirection: e.currentTarget.value as SceneryPreferences['lightDirection'] })}
                >
                  {SCENERY_RULES.lightDirection.values.map((direction, i) => (
                    <option key={direction} value={direction}>
                      {copy.choices.lightDirection[i]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </details>
          <details className="scenery-group">
            <summary>
              {copy.ambientSurfaces}
              <Icon icon="ri:add-line" />
            </summary>
            <div className="scenery-group-body">
              <p className="appearance-caption">{copy.ambientSurfaceHint}</p>
              {numeric('lightSurface')}
              {numeric('lightTextShadow')}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
