import { StudioRange } from '@components/live2d/StudioRange';
import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import { prepareStudioBackground } from '@lib/live2d/studio-background';
import { INITIAL_STUDIO_SCENE, STUDIO_BACKGROUNDS, type StudioScene } from '@lib/live2d/studio-export';
import { STUDIO_FILTERS, studioFilterCss } from '@lib/live2d/studio-state';
import { STUDIO_VIEWPORT_LIMITS } from '@lib/live2d/studio-viewport';
import { type Dispatch, type SetStateAction, useEffect, useRef } from 'react';

interface Props {
  scene: StudioScene;
  onBackground: (blob: Blob) => void;
  setScene: Dispatch<SetStateAction<StudioScene>>;
  compareOriginal: boolean;
  setCompareOriginal: Dispatch<SetStateAction<boolean>>;
  backgroundLoading: boolean;
  setBackgroundLoading: Dispatch<SetStateAction<boolean>>;
  setNotice: Dispatch<SetStateAction<string>>;
  name: string;
}

/** Scene controls stay separate from the renderer; local file work ends when this tab closes. */
export function Live2DStudioScene({
  scene,
  onBackground,
  setScene,
  compareOriginal,
  setCompareOriginal,
  backgroundLoading,
  setBackgroundLoading,
  setNotice,
  name,
}: Props) {
  const { t } = useTranslation();
  const backgroundRequest = useRef(0);
  const backgroundFileRef = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      backgroundRequest.current++;
      setBackgroundLoading(false);
    },
    [setBackgroundLoading],
  );
  const updateScene = <K extends keyof StudioScene>(key: K, value: StudioScene[K]) =>
    setScene((current) => ({ ...current, [key]: value }));
  const resetScene = () => {
    backgroundRequest.current++;
    setBackgroundLoading(false);
    setCompareOriginal(false);
    setScene(INITIAL_STUDIO_SCENE);
  };
  return (
    <>
      <fieldset className="live2d-studio-filter-field">
        <legend>{t('live2d.studio.filter')}</legend>
        <div className="live2d-studio-filter-grid">
          {Object.keys(STUDIO_FILTERS).map((f) => (
            <button
              type="button"
              key={f}
              aria-pressed={scene.filter === f}
              onClick={() => {
                updateScene('filter', f as StudioScene['filter']);
                setCompareOriginal(false);
              }}
            >
              <span
                className="live2d-studio-filter-swatch"
                style={{ filter: studioFilterCss(f as StudioScene['filter']) }}
                aria-hidden="true"
              >
                <Icon icon="ri:flower-line" />
              </span>
              {t(`live2d.studio.filter.${f}` as 'live2d.studio.filter.original')}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="live2d-studio-parameter">
        <span>{t('live2d.studio.filterStrength')}</span>
        <output>{scene.filterStrength}%</output>
        <StudioRange
          aria-label={t('live2d.studio.filterStrength')}
          min={0}
          max={100}
          step={1}
          value={scene.filterStrength}
          onValue={(value) => updateScene('filterStrength', value)}
        />
      </label>
      <button
        type="button"
        className="live2d-studio-compare"
        aria-pressed={compareOriginal}
        onClick={() => setCompareOriginal((value) => !value)}
      >
        <Icon icon="ri:contrast-2-line" />
        {t(compareOriginal ? 'live2d.studio.restoreFilter' : 'live2d.studio.compare')}
      </button>
      <label>
        {t('live2d.studio.background')}
        <select
          value={scene.background}
          onChange={(e) => {
            backgroundRequest.current++;
            setBackgroundLoading(false);
            setScene((current) => ({
              ...current,
              background: e.target.value as StudioScene['background'],
              backgroundImage: undefined,
            }));
          }}
        >
          {Object.keys(STUDIO_BACKGROUNDS).map((b) => (
            <option value={b} key={b}>
              {t(`live2d.studio.background.${b}` as 'live2d.studio.background.paper')}
            </option>
          ))}
        </select>
      </label>
      <div className="live2d-studio-file-actions">
        <button type="button" onClick={() => backgroundFileRef.current?.click()}>
          {t(backgroundLoading ? 'live2d.loading' : 'live2d.studio.uploadBackground')}
        </button>
        {scene.backgroundImage && (
          <button
            type="button"
            onClick={() => {
              backgroundRequest.current++;
              setBackgroundLoading(false);
              updateScene('backgroundImage', undefined);
            }}
          >
            {t('live2d.studio.removeBackground')}
          </button>
        )}
      </div>
      <input
        ref={backgroundFileRef}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp"
        aria-label={t('live2d.studio.uploadBackground')}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          const request = ++backgroundRequest.current;
          setBackgroundLoading(true);
          try {
            const blob = await prepareStudioBackground(file);
            if (request !== backgroundRequest.current) return;
            onBackground(blob);
            setNotice(t('live2d.studio.backgroundLocal'));
          } catch {
            if (request === backgroundRequest.current) setNotice(t('live2d.studio.backgroundInvalid'));
          } finally {
            if (request === backgroundRequest.current) setBackgroundLoading(false);
          }
        }}
      />
      <p className="live2d-studio-note">{t('live2d.studio.backgroundHelp')}</p>
      {(['zoom', 'x', 'y'] as const).map((key) => (
        <label className="live2d-studio-parameter" key={key}>
          <span>{t(`live2d.studio.${key}`)}</span>
          <output>{scene[key]}%</output>
          <StudioRange
            aria-label={t(`live2d.studio.${key}`)}
            min={STUDIO_VIEWPORT_LIMITS[key].min}
            max={STUDIO_VIEWPORT_LIMITS[key].max}
            step={0.1}
            value={scene[key]}
            onValue={(value) => updateScene(key, value)}
          />
        </label>
      ))}
      <label>
        {t('live2d.studio.speaker')}
        <input
          maxLength={40}
          value={scene.speaker}
          placeholder={name}
          onChange={(e) => updateScene('speaker', e.target.value)}
        />
      </label>
      <label>
        {t('live2d.studio.dialogue')}
        <textarea rows={3} maxLength={160} value={scene.dialogue} onChange={(e) => updateScene('dialogue', e.target.value)} />
      </label>
      <button type="button" onClick={resetScene}>
        {t('live2d.studio.resetScene')}
      </button>
      <p className="live2d-studio-note">{t('live2d.studio.sceneHelp')}</p>
    </>
  );
}
