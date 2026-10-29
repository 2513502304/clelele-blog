import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@components/ui/dialog';
import { usePointerRange } from '@hooks/usePointerRange';
import { useTranslation } from '@hooks/useTranslation';
import { Icon } from '@iconify/react';
import type { Live2DRenderer } from '@lib/live2d/renderer';
import { downloadStudioFile, exportStudioScene, STUDIO_BACKGROUNDS, type StudioScene } from '@lib/live2d/studio-export';
import { parseStudioPose, STUDIO_FILTERS } from '@lib/live2d/studio-state';
import type { Live2DCatalog } from '@lib/live2d/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import '@styles/components/live2d-studio.css';

interface Props {
  renderer: Live2DRenderer | null;
  ready: boolean;
  failed: boolean;
  onRetry: () => void;
  catalog: Live2DCatalog;
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
const initialScene: StudioScene = { background: 'paper', filter: 'original', zoom: 100, x: 0, y: 0, speaker: '', dialogue: '' };

/** Keep pointer capture on the same input throughout React updates; native input still handles keyboard changes. */
function StudioRange({
  onValue,
  ...props
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  'aria-label': string;
  onValue: (value: number) => void;
}) {
  const pointer = usePointerRange(onValue);
  return <input type="range" {...props} {...pointer} />;
}

/** A deliberately local editor: one existing renderer, model-bounded edits, no uploads or frame polling. */
export function Live2DStudio({
  renderer,
  ready,
  failed,
  onRetry,
  catalog,
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
  const [limit, setLimit] = useState(24);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [scene, setScene] = useState(initialScene);
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
  const filteredParameters = parameters.filter((p) => p.min < p.max && p.id.toLowerCase().includes(paramQuery.toLowerCase()));
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new model invalidates the previous parameter draft.
  useEffect(() => {
    setOverrides({});
    setNotice('');
    setParamQuery('');
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
  const updateScene = <K extends keyof StudioScene>(key: K, value: StudioScene[K]) =>
    setScene((current) => ({ ...current, [key]: value }));
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
        await exportStudioScene(frame, scene, stage.clientWidth / stage.clientHeight),
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
              data-background={scene.background}
              style={{ backgroundColor: STUDIO_BACKGROUNDS[scene.background] }}
            >
              <div
                className="live2d-studio-model"
                ref={onHost}
                style={{
                  filter: STUDIO_FILTERS[scene.filter],
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
            <footer className="live2d-studio-preview-tools">
              <button type="button" onClick={onPause} disabled={!ready}>
                <Icon icon={paused ? 'ri:play-line' : 'ri:pause-line'} />
                {t(paused ? 'live2d.resume' : 'live2d.pause')}
              </button>
              <span>{t('live2d.studio.local')}</span>
              <button
                type="button"
                className="live2d-studio-export"
                disabled={!ready || exporting}
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
                  {!filtered.length && <p>{t('live2d.noResults')}</p>}
                  <p className="live2d-studio-note">{t('live2d.studio.modelHelp')}</p>
                </>
              )}
              {tab === 'pose' && (
                <>
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
                      {motions.map((m) => (
                        <option value={`${m.group}\u0000${m.index}`} key={`${m.group}:${m.index}`}>
                          {m.group}
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
                      {expressions.map((id) => (
                        <option key={id}>{id}</option>
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
                      <span title={p.id}>{p.id}</span>
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
                <>
                  <label>
                    {t('live2d.studio.filter')}
                    <select
                      value={scene.filter}
                      onChange={(e) => updateScene('filter', e.target.value as StudioScene['filter'])}
                    >
                      {Object.keys(STUDIO_FILTERS).map((f) => (
                        <option value={f} key={f}>
                          {t(`live2d.studio.filter.${f}` as 'live2d.studio.filter.original')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('live2d.studio.background')}
                    <select
                      value={scene.background}
                      onChange={(e) => updateScene('background', e.target.value as StudioScene['background'])}
                    >
                      {Object.keys(STUDIO_BACKGROUNDS).map((b) => (
                        <option value={b} key={b}>
                          {t(`live2d.studio.background.${b}` as 'live2d.studio.background.paper')}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(['zoom', 'x', 'y'] as const).map((key) => (
                    <label className="live2d-studio-parameter" key={key}>
                      <span>{t(`live2d.studio.${key}`)}</span>
                      <output>{scene[key]}%</output>
                      <StudioRange
                        aria-label={t(`live2d.studio.${key}`)}
                        min={key === 'zoom' ? 50 : -40}
                        max={key === 'zoom' ? 180 : 40}
                        step={1}
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
                    <textarea
                      rows={3}
                      maxLength={160}
                      value={scene.dialogue}
                      onChange={(e) => updateScene('dialogue', e.target.value)}
                    />
                  </label>
                  <button type="button" onClick={() => setScene(initialScene)}>
                    {t('live2d.studio.resetScene')}
                  </button>
                  <p className="live2d-studio-note">{t('live2d.studio.sceneHelp')}</p>
                </>
              )}
            </div>
            <output className="live2d-studio-notice">{notice || t('live2d.studio.sessionOnly')}</output>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
