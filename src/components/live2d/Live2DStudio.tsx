import { Live2DStudioScene } from '@components/live2d/Live2DStudioScene';
import { StudioRange } from '@components/live2d/StudioRange';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@components/ui/dialog';
import { useStudioViewport } from '@hooks/useStudioViewport';
import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import type { Live2DRenderer } from '@lib/live2d/renderer';
import { downloadStudioFile, exportStudioScene, INITIAL_STUDIO_SCENE, STUDIO_BACKGROUNDS } from '@lib/live2d/studio-export';
import { studioActionLabel, studioParameterLabel } from '@lib/live2d/studio-labels';
import { parseStudioPose, studioFilterCss } from '@lib/live2d/studio-state';
import type { Live2DCatalog } from '@lib/live2d/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import '@styles/components/live2d-studio.css';

interface Props {
  renderer: Live2DRenderer | null;
  ready: boolean;
  failed: boolean;
  onRetry: () => void;
  catalog: Live2DCatalog;
  catalogNotice?: string;
  onRetryCatalog?: () => void;
  selection: { characterId: string; costumeId: string };
  name: string;
  paused: boolean;
  selectedMotion: string;
  selectedExpression: string;
  onMotion: (group: string, index: number) => void;
  onResetMotion: () => void;
  onExpression: (expression?: string) => void;
  onSelect: (selection: { characterId: string; costumeId: string }) => void;
  onHost: (host: HTMLDivElement | null) => void;
  onClose: () => void;
  onPause: () => void;
}

/** A deliberately local editor: one existing renderer, model-bounded edits, no uploads or frame polling. */
export function Live2DStudio({
  renderer,
  ready,
  failed,
  onRetry,
  catalog,
  catalogNotice,
  onRetryCatalog,
  selection,
  name,
  paused,
  selectedMotion,
  selectedExpression,
  onMotion,
  onResetMotion,
  onExpression,
  onSelect,
  onHost,
  onClose,
  onPause,
}: Props) {
  const { t, locale } = useTranslation();
  const [tab, setTab] = useState<'model' | 'pose' | 'scene'>('model');
  const [source, setSource] = useState(() => {
    const current = catalog.characters
      .find((c) => c.id === selection.characterId)
      ?.costumes.find((c) => c.id === selection.costumeId);
    return current ? (current.entryPath.endsWith('.native.json') ? 'our-notes' : 'bestdori') : 'all';
  });
  const [query, setQuery] = useState('');
  const [paramQuery, setParamQuery] = useState('');
  const [actionQuery, setActionQuery] = useState('');
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [limit, setLimit] = useState(24);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [scene, setScene] = useState(INITIAL_STUDIO_SCENE);
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const backgroundUrls = useRef(new Set<string>());
  const stageRef = useRef<HTMLDivElement>(null);
  useStudioViewport(stageRef, ready, scene, setScene);
  const fileRef = useRef<HTMLInputElement>(null);
  // Object URLs have a single owner and are released on replacement/reset/close.
  useEffect(
    () => () => {
      if (scene.backgroundImage) {
        URL.revokeObjectURL(scene.backgroundImage);
        backgroundUrls.current.delete(scene.backgroundImage);
      }
    },
    [scene.backgroundImage],
  );
  useEffect(
    () => () => {
      for (const url of backgroundUrls.current) URL.revokeObjectURL(url);
      backgroundUrls.current.clear();
    },
    [],
  );
  const setBackground = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    // Own the URL immediately, even if the dialog closes before React commits the draft.
    backgroundUrls.current.add(url);
    setScene((current) => ({ ...current, backgroundImage: url }));
  };
  const model = `${selection.characterId}/${selection.costumeId}`;
  const modelRef = useRef(model);
  modelRef.current = model;
  useEffect(
    () => () => {
      modelRef.current = '';
    },
    [],
  );
  const parameters = useMemo(() => (ready ? (renderer?.getParameters() ?? []) : []), [renderer, ready]);
  const motions = ready
    ? Object.entries(renderer?.getMotions() ?? {}).flatMap(([group, entries]) => entries.map((_, index) => ({ group, index })))
    : [];
  const expressions = ready ? (renderer?.getExpressions() ?? []) : [];
  const label = (labels: Record<string, string>) => labels[locale] ?? labels.zh ?? labels.en ?? Object.values(labels)[0];
  const filtered = useMemo(
    () =>
      catalog.characters
        .map((character) => ({
          ...character,
          costumes: character.costumes.filter(
            (costume) =>
              (source === 'all' || costume.entryPath.endsWith('.native.json') === (source === 'our-notes')) &&
              (!query ||
                [character.id, ...Object.values(character.label), ...Object.values(costume.label)]
                  .join(' ')
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase())),
          ),
        }))
        .filter((character) => character.costumes.length),
    [catalog, source, query],
  );
  const selectedCharacter = filtered.find((character) => character.id === selection.characterId);
  const filteredParameters = parameters.filter(
    (p) => p.min < p.max && studioParameterLabel(p.id, locale).toLowerCase().includes(paramQuery.toLowerCase()),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new model invalidates the previous parameter draft.
  useEffect(() => {
    setOverrides({});
    setNotice('');
    setParamQuery('');
    setActionQuery('');
    setLimit(24);
  }, [model]);
  useEffect(
    () => () => {
      renderer?.setParameters({});
    },
    [renderer],
  );
  const updatePose = (next: Record<string, number>) => {
    setOverrides(next);
    renderer?.setParameters(next);
  };
  const actionMatches = (id: string) => studioActionLabel(id, locale).toLowerCase().includes(actionQuery.toLowerCase());
  const exportImage = async () => {
    const frame = renderer?.captureFrame();
    const stage = stageRef.current;
    if (!frame || !stage) {
      setNotice(t('live2d.studio.failed'));
      return;
    }
    setExporting(true);
    try {
      downloadStudioFile(
        await exportStudioScene(
          frame,
          compareOriginal ? { ...scene, filter: 'original' } : scene,
          stage.clientWidth / stage.clientHeight,
        ),
        `${selection.costumeId}.png`,
      );
      setNotice(t('live2d.studio.exported'));
    } catch {
      setNotice(t('live2d.studio.failed'));
    } finally {
      setExporting(false);
    }
  };
  return (
    <Dialog
      keepLive2DActive
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="live2d-studio" animated={false} stableScroll showClose={false}>
        <header className="live2d-studio-header">
          <div className="live2d-studio-title">
            <Icon icon="ri:focus-3-line" />
            <div>
              <DialogTitle>{t('live2d.studio.title')}</DialogTitle>
              <DialogDescription>{t('live2d.studio.description')}</DialogDescription>
            </div>
          </div>
          <button type="button" className="live2d-studio-close" onClick={onClose} aria-label={t('live2d.close')}>
            <Icon icon="ri:close-line" />
          </button>
        </header>
        <div className="live2d-studio-workspace">
          <section className="live2d-studio-preview">
            <div className="live2d-studio-caption">
              <span>{name}</span>
              <span>{selection.costumeId.startsWith('our-notes-') ? 'OUR NOTES' : 'GIRLS BAND PARTY'}</span>
            </div>
            <div
              ref={stageRef}
              className="live2d-studio-stage"
              role="application"
              tabIndex={ready ? 0 : -1}
              aria-label={t('live2d.studio.stage')}
              aria-describedby="live2d-studio-gestures"
              data-ready={ready}
              data-background={scene.background}
              style={{ backgroundColor: STUDIO_BACKGROUNDS[scene.background] }}
            >
              {scene.backgroundImage && <img className="live2d-studio-background" src={scene.backgroundImage} alt="" />}
              <div
                className="live2d-studio-model"
                ref={onHost}
                style={{
                  filter: compareOriginal ? 'none' : studioFilterCss(scene.filter, scene.filterStrength),
                  transform: `translate(${scene.x}%, ${scene.y}%) scale(${scene.zoom / 100})`,
                }}
              />
              {!ready && (
                <output className="live2d-studio-loading">
                  <Icon icon="ri:loader-4-line" />
                  {failed ? (
                    <>
                      <span>{t('live2d.failed')}</span>
                      <button type="button" onClick={onRetry}>
                        {t('live2d.retry')}
                      </button>
                    </>
                  ) : (
                    t('live2d.loading')
                  )}
                </output>
              )}
              {scene.dialogue && (
                <div className="live2d-studio-dialogue">
                  {scene.speaker && <strong>{scene.speaker}</strong>}
                  <p>{scene.dialogue}</p>
                </div>
              )}
            </div>
            <p id="live2d-studio-gestures" className="live2d-studio-gestures">
              {t('live2d.studio.gestures')}
            </p>
            <footer className="live2d-studio-preview-tools">
              <button type="button" onClick={onPause} disabled={!ready}>
                <Icon icon={paused ? 'ri:play-line' : 'ri:pause-line'} />
                {t(paused ? 'live2d.resume' : 'live2d.pause')}
              </button>
              <span>{t('live2d.studio.local')}</span>
              <button
                type="button"
                className="live2d-studio-export"
                disabled={!ready || exporting || backgroundLoading}
                onClick={() => void exportImage()}
              >
                <Icon icon="ri:download-2-line" />
                {t('live2d.studio.export')}
              </button>
            </footer>
          </section>
          <aside className="live2d-studio-editor">
            <nav className="live2d-studio-tabs" aria-label={t('live2d.studio.title')}>
              {(['model', 'pose', 'scene'] as const).map((key) => (
                <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>
                  {t(`live2d.studio.${key}`)}
                </button>
              ))}
            </nav>
            <div className="live2d-studio-fields">
              {tab === 'model' && (
                <>
                  <label>
                    {t('live2d.studio.source')}
                    <select value={source} onChange={(e) => setSource(e.target.value)}>
                      <option value="all">{t('live2d.studio.all')}</option>
                      <option value="our-notes">Our Notes</option>
                      <option value="bestdori">Girls Band Party · Bestdori</option>
                    </select>
                  </label>
                  {catalogNotice && (
                    <div className="live2d-catalog-notice" aria-live="polite">
                      <span>{catalogNotice}</span>
                      {onRetryCatalog && (
                        <button type="button" onClick={onRetryCatalog}>
                          {t('live2d.retry')}
                        </button>
                      )}
                    </div>
                  )}
                  <input
                    type="search"
                    aria-label={t('live2d.search')}
                    placeholder={t('live2d.searchPlaceholder')}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <label>
                    {t('live2d.character')}
                    <select
                      value={selectedCharacter?.id ?? ''}
                      onChange={(e) => {
                        const c = filtered.find((c) => c.id === e.target.value);
                        if (c) onSelect({ characterId: c.id, costumeId: c.costumes[0].id });
                      }}
                    >
                      <option value="" disabled>
                        {t('live2d.studio.choose')}
                      </option>
                      {filtered.map((c) => (
                        <option value={c.id} key={c.id}>
                          {label(c.label)} · {c.costumes.length}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="live2d-studio-costumes">
                    {selectedCharacter?.costumes.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        aria-pressed={c.id === selection.costumeId}
                        onClick={() => onSelect({ characterId: selection.characterId, costumeId: c.id })}
                      >
                        {label(c.label)}
                        <small>{(c.packageBytes / 1_000_000).toFixed(1)} MB</small>
                      </button>
                    ))}
                  </div>
                  {!filtered.length && !catalogNotice && <p>{t('live2d.noResults')}</p>}
                  <p className="live2d-studio-note">{t('live2d.studio.modelHelp')}</p>
                </>
              )}
              {tab === 'pose' && (
                <>
                  <input
                    type="search"
                    aria-label={t('live2d.studio.searchActions')}
                    placeholder={t('live2d.studio.searchActions')}
                    value={actionQuery}
                    onChange={(e) => setActionQuery(e.target.value)}
                  />
                  <label>
                    {t('live2d.motion')}
                    <select
                      disabled={!ready || paused}
                      value={selectedMotion}
                      onChange={(e) => {
                        const m = motions.find((motion) => `${motion.group}\u0000${motion.index}` === e.target.value);
                        if (m) onMotion(m.group, m.index);
                        else onResetMotion();
                      }}
                    >
                      <option value="">{t('live2d.studio.choose')}</option>
                      {motions
                        .filter((m) => actionMatches(m.group) || `${m.group}\u0000${m.index}` === selectedMotion)
                        .map((m) => (
                          <option value={`${m.group}\u0000${m.index}`} key={`${m.group}:${m.index}`}>
                            {studioActionLabel(m.group, locale)}
                            {m.index ? ` ${m.index + 1}` : ''}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    {t('live2d.expression')}
                    <select
                      disabled={!ready || paused}
                      value={selectedExpression}
                      onChange={(e) => onExpression(e.target.value || undefined)}
                    >
                      <option value="">{t('live2d.defaultExpression')}</option>
                      {expressions
                        .filter((id) => actionMatches(id) || id === selectedExpression)
                        .map((id) => (
                          <option key={id} value={id}>
                            {studioActionLabel(id, locale)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="live2d-studio-section-title">
                    <strong>{t('live2d.studio.parameters')}</strong>
                    <button type="button" onClick={() => updatePose({})}>
                      {t('live2d.studio.reset')}
                    </button>
                  </div>
                  <p className="live2d-studio-note">{t('live2d.studio.poseHelp')}</p>
                  <input
                    type="search"
                    aria-label={t('live2d.studio.searchParams')}
                    placeholder={t('live2d.studio.searchParams')}
                    value={paramQuery}
                    onChange={(e) => {
                      setParamQuery(e.target.value);
                      setLimit(24);
                    }}
                  />
                  {filteredParameters.slice(0, limit).map((p) => (
                    <label className="live2d-studio-parameter" key={p.id}>
                      <span title={studioParameterLabel(p.id, locale)}>{studioParameterLabel(p.id, locale)}</span>
                      <output>{(overrides[p.id] ?? p.value).toFixed(2)}</output>
                      <StudioRange
                        aria-label={p.id}
                        min={p.min}
                        max={p.max}
                        step={(p.max - p.min) / 200 || 1}
                        value={overrides[p.id] ?? p.value}
                        onValue={(value) => updatePose({ ...overrides, [p.id]: value })}
                      />
                    </label>
                  ))}
                  {filteredParameters.length > limit && (
                    <button type="button" onClick={() => setLimit((n) => n + 24)}>
                      {t('live2d.studio.more')}
                    </button>
                  )}
                  <div className="live2d-studio-file-actions">
                    <button
                      type="button"
                      disabled={!ready}
                      onClick={() =>
                        downloadStudioFile(
                          new Blob([JSON.stringify({ version: 1, model, parameters: overrides }, null, 2)], {
                            type: 'application/json',
                          }),
                          `${selection.costumeId}-pose.json`,
                        )
                      }
                    >
                      {t('live2d.studio.savePose')}
                    </button>
                    <button type="button" disabled={!ready} onClick={() => fileRef.current?.click()}>
                      {t('live2d.studio.loadPose')}
                    </button>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    hidden
                    accept="application/json,.json"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      try {
                        if (file.size > 100_000) throw new Error('size');
                        const text = await file.text();
                        if (modelRef.current !== model) return;
                        updatePose(parseStudioPose(text, model, parameters));
                        setNotice(t('live2d.studio.poseLoaded'));
                      } catch {
                        setNotice(t('live2d.studio.poseInvalid'));
                      }
                    }}
                  />
                </>
              )}
              {tab === 'scene' && (
                <Live2DStudioScene
                  scene={scene}
                  onBackground={setBackground}
                  setScene={setScene}
                  compareOriginal={compareOriginal}
                  setCompareOriginal={setCompareOriginal}
                  backgroundLoading={backgroundLoading}
                  setBackgroundLoading={setBackgroundLoading}
                  setNotice={setNotice}
                  name={name}
                />
              )}
            </div>
            <output className="live2d-studio-notice">{notice || t('live2d.studio.sessionOnly')}</output>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
