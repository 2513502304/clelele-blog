import Popover from '@components/ui/popover';
import { Icon } from '@iconify/react';
import { computeStyleGalleryVisualFeatureFromFile } from '@lib/style-gallery-visual-feature-browser';
import type {
  StyleGalleryVisualFeature,
  StyleGalleryVisualFilterLabels,
  StyleGalleryVisualSearchMode,
  StyleGalleryVisualSearchScope,
} from '@lib/style-gallery-visual-types';
import { cn } from '@lib/utils';
import { useEffect, useRef, useState } from 'react';

export type { StyleGalleryVisualFilterLabels } from '@lib/style-gallery-visual-types';

interface Props {
  scope: StyleGalleryVisualSearchScope;
  labels: StyleGalleryVisualFilterLabels;
  onResults: (identities: Set<string> | null) => void;
}

type VisualTab = 'image' | 'palette';

const IMAGE_MODES: StyleGalleryVisualSearchMode[] = ['combined', 'near-duplicate', 'semantic'];

/**
 * 三个 Gallery 列表页共用的视觉筛选器。原图只在浏览器本地解码和推理，API 收到的是固定宽度特征；
 * 结果集继续与页面已有 prompt/平台/日期筛选做交集，不另建一套列表状态或分页实现。
 */
export default function StyleGalleryVisualFilter({ scope, labels, onResults }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<VisualTab>('image');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<Exclude<StyleGalleryVisualSearchMode, 'palette'>>('combined');
  const [color, setColor] = useState('#ef7894');
  const [range, setRange] = useState(50);
  const [loading, setLoading] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preparedFeature = useRef<{ file: File; promise: Promise<StyleGalleryVisualFeature> } | null>(null);
  const searchGeneration = useRef(0);
  const searchController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(
    () => () => {
      searchGeneration.current += 1;
      searchController.current?.abort();
    },
    [],
  );

  function cancelPendingSearch() {
    searchGeneration.current += 1;
    searchController.current?.abort();
    searchController.current = null;
    setLoading(false);
  }

  function prepareFeature(nextFile: File): Promise<StyleGalleryVisualFeature> {
    if (preparedFeature.current?.file === nextFile) return preparedFeature.current.promise;
    const entry = { file: nextFile, promise: computeStyleGalleryVisualFeatureFromFile(nextFile) };
    preparedFeature.current = entry;
    // 选图后立即后台准备；失败项必须丢弃，点击重试时才能重新初始化模型和特征计算。
    void entry.promise.catch(() => {
      if (preparedFeature.current === entry) preparedFeature.current = null;
    });
    return entry.promise;
  }

  function selectFile(nextFile: File | null) {
    cancelPendingSearch();
    setFile(nextFile);
    setError(null);
    preparedFeature.current = null;
    if (nextFile) void prepareFeature(nextFile);
  }

  async function runSearch() {
    if (loading || (tab === 'image' && !file)) return;
    const generation = searchGeneration.current + 1;
    searchGeneration.current = generation;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setLoading(true);
    setError(null);
    try {
      const body =
        tab === 'image' && file
          ? { mode, scope, range, feature: await prepareFeature(file) }
          : { mode: 'palette' as const, scope, color, range };
      if (generation !== searchGeneration.current) return;
      const response = await fetch('/api/style-gallery/visual-search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
      const data = (await response.json()) as { matches?: string[] };
      if (generation !== searchGeneration.current) return;
      const identities = new Set(data.matches ?? []);
      setMatchCount(identities.size);
      onResults(identities);
      setOpen(false);
    } catch (searchError) {
      if (generation !== searchGeneration.current || (searchError as { name?: string })?.name === 'AbortError') return;
      console.error('[style-gallery] Visual search failed.', searchError);
      setError(labels.failed);
    } finally {
      if (generation === searchGeneration.current) {
        searchController.current = null;
        setLoading(false);
      }
    }
  }

  function reset() {
    cancelPendingSearch();
    setMatchCount(null);
    setError(null);
    onResults(null);
  }

  const modeLabels: Record<Exclude<StyleGalleryVisualSearchMode, 'palette'>, string> = {
    combined: labels.combined,
    'near-duplicate': labels.nearDuplicate,
    semantic: labels.semantic,
  };
  const modeHelp: Record<Exclude<StyleGalleryVisualSearchMode, 'palette'>, string> = {
    combined: labels.combinedHelp,
    'near-duplicate': labels.nearDuplicateHelp,
    semantic: labels.semanticHelp,
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      offset={6}
      dismissOnAncestorScroll={false}
      constrainToAvailableHeight
      className="w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-xl"
      render={() => (
        <div className="p-4">
          <div className="mb-4 grid grid-cols-2 rounded-md bg-muted p-1">
            {(['image', 'palette'] as const).map((candidate) => (
              <button
                type="button"
                key={candidate}
                onClick={() => setTab(candidate)}
                className={cn(
                  'h-9 rounded-sm font-bold text-sm transition',
                  tab === candidate ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {candidate === 'image' ? labels.imageTab : labels.paletteTab}
              </button>
            ))}
          </div>

          {tab === 'image' ? (
            <div className="space-y-4">
              <label className="grid cursor-pointer grid-cols-[5rem_1fr] items-center gap-3 rounded-md border border-border p-3 transition hover:border-primary/60">
                <span className="flex aspect-square items-center justify-center overflow-hidden rounded-sm bg-muted">
                  {previewUrl ? (
                    <img src={previewUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <Icon icon="ri:image-add-line" className="size-6 text-muted-foreground" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block font-bold text-sm">{labels.chooseImage}</span>
                  <span className="block truncate text-muted-foreground text-xs">{file?.name ?? 'PNG / JPEG / WebP'}</span>
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) => selectFile(event.currentTarget.files?.[0] ?? null)}
                />
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {IMAGE_MODES.map((candidate) => (
                  <button
                    type="button"
                    key={candidate}
                    title={modeHelp[candidate as Exclude<StyleGalleryVisualSearchMode, 'palette'>]}
                    aria-label={`${modeLabels[candidate as Exclude<StyleGalleryVisualSearchMode, 'palette'>]}: ${modeHelp[candidate as Exclude<StyleGalleryVisualSearchMode, 'palette'>]}`}
                    onClick={() => setMode(candidate as Exclude<StyleGalleryVisualSearchMode, 'palette'>)}
                    className={cn(
                      'min-h-9 rounded-md border px-2 font-medium text-xs transition',
                      mode === candidate
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {modeLabels[candidate as Exclude<StyleGalleryVisualSearchMode, 'palette'>]}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <label className="flex items-center gap-3 rounded-md border border-border p-3">
                <input
                  type="color"
                  aria-label={labels.paletteTab}
                  value={color}
                  onChange={(event) => setColor(event.currentTarget.value)}
                  className="size-12 cursor-pointer rounded-sm border-0 bg-transparent p-0"
                />
                <span className="font-mono text-sm uppercase tabular-nums">{color}</span>
              </label>
            </div>
          )}

          <label className="mt-4 block border-border border-t pt-3" title={labels.rangeHelp}>
            <span className="mb-2 flex items-center justify-between gap-3 text-xs">
              <span className="font-bold text-foreground">{labels.range}</span>
              <output className="font-mono text-primary tabular-nums">{range}%</output>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={range}
              aria-label={labels.range}
              aria-describedby="style-gallery-visual-range-help"
              // 24px 命中区覆盖视觉滑块外沿；input 事件保证鼠标和触控拖动时连续更新，而非仅在释放时跳值。
              onInput={(event) => setRange(Number(event.currentTarget.value))}
              className="block h-6 w-full cursor-ew-resize accent-primary"
              style={{ touchAction: 'none' }}
            />
            <span id="style-gallery-visual-range-help" className="mt-2 flex justify-between text-muted-foreground text-xs">
              <span>{labels.rangePrecise}</span>
              <span>{labels.rangeBroad}</span>
            </span>
          </label>

          {error && <p className="mt-3 text-red-500 text-xs">{error}</p>}
          <div className="mt-4 flex items-center justify-between gap-2 border-border border-t pt-3">
            <button
              type="button"
              onClick={reset}
              disabled={matchCount === null}
              className="h-9 px-2 text-muted-foreground text-xs disabled:opacity-40"
            >
              {labels.reset}
            </button>
            <button
              type="button"
              onClick={() => void runSearch()}
              disabled={loading || (tab === 'image' && !file)}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 font-bold text-primary-foreground text-xs disabled:opacity-50"
            >
              <Icon
                icon={loading ? 'ri:loader-4-line' : 'ri:search-eye-line'}
                className={cn('size-4', loading && 'animate-spin')}
              />
              {loading ? labels.searching : labels.search}
            </button>
          </div>
        </div>
      )}
    >
      <button
        type="button"
        className={cn(
          'inline-flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 font-bold text-sm transition hover:border-primary/60',
          matchCount !== null && 'border-primary text-primary',
        )}
      >
        <Icon icon="ri:scan-2-line" className="size-4" />
        <span>{matchCount === null ? labels.trigger : labels.matches.replace('{count}', String(matchCount))}</span>
        <Icon icon="ri:arrow-down-s-line" className="size-4" />
      </button>
    </Popover>
  );
}
