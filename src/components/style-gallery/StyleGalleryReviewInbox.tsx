import { useIsMobile } from '@hooks/useMediaQuery';
import { mapWithConcurrency } from '@lib/map-with-concurrency';
import {
  availableOutputs,
  type GenerationJob,
  type GenerationPlatform,
  publishedOutputs,
} from '@lib/style-gallery-generation-settings';
import { getStyleGalleryManagementToken, rememberStyleGalleryManagementToken } from '@lib/style-gallery-management-token';
import {
  confirmStudioOutput,
  discardStudioOutput,
  legacyStudioSources,
  readProviderKey,
  studioRequest,
} from '@lib/style-gallery-studio-client';
import { cn } from '@lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RiArrowRightLine, RiCheckLine, RiRefreshLine } from 'react-icons/ri';
import type { StyleGalleryImageRef } from '@/types/style-gallery';
import { GenerationRecipe } from './GenerationRecipe';
import { type ThumbnailProps, type Thumbnails, useStudioOriginal, useThumbnail } from './useStudioReviewImage';
import { DiscardOutputAction } from './DiscardOutputAction';
import { studioLanguage } from './StyleGalleryGenerationFields';
import { GenerationViewer } from './StyleGalleryGenerationViewer';
import StyleGalleryGrid from './StyleGalleryGrid';
import './gallery-generator.css';

const platforms = ['gpt-image', 'pixai'] as const;
type Group = 'pending' | 'saved' | 'tasks';
type Source = { stale?: boolean; account?: boolean; slug: string; platform: GenerationPlatform; jobs: GenerationJob[] };
type Row = { account?: boolean; slug: string; job: GenerationJob; index: number; group: Group; id: string };
const base = (slug: string) => `/api/style-gallery/generations/${encodeURIComponent(slug)}`;
const inputClass = 'min-h-11 min-w-0 rounded-lg border border-border bg-background px-3';
const buttonClass =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:border-primary disabled:opacity-50';

function outputRows(sources: Source[]) {
  const rows: Row[] = [];
  for (const { jobs, slug, platform, account } of sources)
    for (const job of jobs) {
      const available = availableOutputs(job),
        saved = publishedOutputs(job);
      for (const index of available)
        rows.push({
          slug,
          account,
          job,
          index,
          group: saved.includes(index) ? 'saved' : 'pending',
          id: [platform, slug, job.id, index].join('/'),
        });
      if (available.length + (job.discarded?.length ?? 0) < (job.settings.count ?? 1))
        rows.push({ slug, account, job, index: -1, group: 'tasks', id: [platform, slug, job.id, 'task'].join('/') });
    }
  return rows.sort((a, b) => b.job.created.localeCompare(a.job.created) || a.id.localeCompare(b.id));
}

function PrivateImage(props: ThumbnailProps) {
  const src = useThumbnail(props);
  return src ? <img src={src} alt="" className="block h-auto w-full" /> : <span className="block aspect-[4/3]" />;
}

function ReviewOutput({
  pool,
  row,
  credential,
  locale,
  gallery,
  onReviewed,
}: {
  pool: Thumbnails;
  row?: Row;
  credential: string;
  locale: string;
  gallery: string;
  onReviewed: (action: 'saved' | 'discarded') => void;
}) {
  const l = useMemo(() => studioLanguage(locale), [locale]);
  const [reference, setReference] = useState<StyleGalleryImageRef[]>([]);
  const [token, setToken] = useState(getStyleGalleryManagementToken);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const [refError, setRefError] = useState(false);
  const lock = useRef(false);
  const slug = row?.slug,
    id = row?.job.id,
    index = row?.index,
    platform = row?.job.settings.platform,
    rowId = row?.id;
  const job = row?.job;
  const thumbnail = useThumbnail({
    pool,
    platform,
    credential,
    url: row && slug ? `${base(slug)}?preview=${row.job.id}&index=${row.index}&thumb=fit` : undefined,
  });
  const original = useStudioOriginal(
    slug && id && index !== undefined ? `${base(slug)}?preview=${id}&index=${index}&reload=${retry}` : undefined,
    platform,
    credential,
  );
  const preview = original?.image;
  const message = error || (original?.failed ? l('原图暂时无法读取。', '原画を読み込めません。', 'Original unavailable.') : '');
  useEffect(() => {
    setError('');
  }, [rowId, retry]);
  useEffect(() => {
    const ctrl = new AbortController();
    setReference([]);
    setRefError(false);
    if (!slug) return;
    void fetch(`/api/style-gallery/prompts/${slug}`, { signal: ctrl.signal, cache: retry ? 'reload' : 'default' })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((data) => {
        if (!ctrl.signal.aborted) setReference(data.item.images);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setRefError(true);
      });
    return () => {
      ctrl.abort();
    };
  }, [slug, retry]);
  async function decide(action: 'save' | 'discard') {
    if (!preview || !job || !slug || index === undefined || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (action === 'discard') {
        await discardStudioOutput(slug, job.settings.platform, credential, job.id, index);
        onReviewed('discarded');
        return;
      }
      await confirmStudioOutput(
        slug,
        job.settings.platform,
        credential,
        job.id,
        index,
        preview.blob,
        token,
        l('上传令牌与当前图库不匹配。', 'アップロードトークンを確認してください。', 'Check the upload token for this gallery.'),
      );
      rememberStyleGalleryManagementToken(token);
      onReviewed('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : '');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      data-inbox-reader
      className="gallery-generator studio-review-reader scroll-mt-24 rounded-xl border border-border bg-card"
    >
      <div className="studio-review-layout">
        <GenerationViewer
          reviewCanvas
          viewId={rowId}
          src={preview?.url ?? thumbnail}
          alt={l('生成结果', '生成結果', 'Generated result')}
          locale={locale}
          references={reference}
          initialHash={job?.settings.platform === 'gpt-image' ? job.settings.referenceHash : undefined}
          placeholder={
            row
              ? message || l('正在读取原图…', '読み込み中…', 'Loading original…')
              : l('选择下方作品开始对比', '下から作品を選んで比較', 'Select a work below to compare')
          }
        />
        <div className="studio-review-notes">
          {refError && (
            <p>
              {l('参考图读取失败', '参照画像を読み込めません', 'Reference unavailable')}{' '}
              <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>
                {l('重试', '再試行', 'Retry')}
              </button>
            </p>
          )}
          {!(job && row) && (
            <h2 className="font-semibold text-muted-foreground">
              {l('生成提示词与参数', 'プロンプトと設定', 'Prompt and settings')}
            </h2>
          )}
          {job && row && (
            <>
              <a className="inline-flex items-center gap-1 text-primary text-sm" href={`${gallery}/${slug}`}>
                {slug}
                <RiArrowRightLine />
              </a>
              <GenerationRecipe key={row.id} prompt={job.prompt} settings={job.settings} locale={locale}>
                {thumbnail && !preview && !message && (
                  <output className="text-muted-foreground text-xs">
                    {l('预览图 · 正在加载原图', 'プレビュー · 原画を読み込み中', 'Preview · Loading original')}
                  </output>
                )}
              </GenerationRecipe>
              {row.group === 'pending' && (
                <form
                  className="studio-review-actions flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void decide('save');
                  }}
                >
                  <label className="grid min-w-0 gap-1 text-sm">
                    {l('图库上传令牌', 'アップロードトークン', 'Gallery upload token')}
                    <input
                      type="password"
                      autoComplete="off"
                      className={inputClass}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    className={`${buttonClass} bg-primary text-primary-foreground`}
                    disabled={!preview || !token.trim() || busy}
                  >
                    <RiCheckLine />
                    {busy
                      ? l('正在保存…', '保存中…', 'Saving…')
                      : l('确认加入子图', 'サブギャラリーに保存', 'Add to sub-gallery')}
                  </button>
                  <DiscardOutputAction
                    key={row.id}
                    locale={locale}
                    disabled={!preview || busy || Boolean(job.publishing?.includes(row.index))}
                    discard={() => void decide('discard')}
                  />
                </form>
              )}
            </>
          )}
          {message && (
            <p role="alert">
              {message}{' '}
              {!preview && (
                <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>
                  {l('重试', '再試行', 'Retry')}
                </button>
              )}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

const reviewPositionKey = 'gallery-generation:review-position';

/** Store only the cursor. A restored ID can open a row only after this session's private discovery returns it. */
function readReviewPosition(): { group: Group; selected: string } {
  try {
    const position = JSON.parse(localStorage.getItem(reviewPositionKey) ?? 'null');
    if (
      position &&
      ['pending', 'saved', 'tasks'].includes(position.group) &&
      typeof position.selected === 'string' &&
      position.selected.length < 400
    )
      return { group: position.group, selected: position.selected };
  } catch {
    /* Storage is optional in private browsing. */
  }
  return { group: 'pending', selected: '' };
}

function Inbox({ keys, locale, gallery }: { keys: Record<GenerationPlatform, string>; locale: string; gallery: string }) {
  const l = useMemo(() => studioLanguage(locale), [locale]);
  const mobile = useIsMobile();
  const thumbs: Thumbnails = useMemo(() => new Map(), []);
  const [canSignIn, setCanSignIn] = useState(false);
  const [sources, setSources] = useState<Source[]>([]),
    [revision, refresh] = useState(0),
    [busy, setBusy] = useState(true),
    [failed, setFailed] = useState(false);
  const [initialPosition] = useState(readReviewPosition);
  const [group, setGroup] = useState<Group>(initialPosition.group),
    [selected, select] = useState(initialPosition.selected),
    [limit, setLimit] = useState(12),
    [notice, setNotice] = useState('');
  useEffect(() => {
    const ctrl = new AbortController();
    setBusy(true);
    setFailed(false);
    // Keep cards visible during refresh, but a refreshed account copy outranks a retained provider copy.
    setSources((previous) => previous.map((source) => ({ ...source, stale: true })));
    let errors = false;
    async function loadPlatform(platform: GenerationPlatform) {
      if (!keys[platform]) return;
      const missing = new Set(legacyStudioSources(platform));
      let failedSlugs: string[] = [];
      let discoveryFailed = false;
      let batch: Source[] = [];
      try {
        const response = await studioRequest(
          `/api/style-gallery/generation-sources?jobs=1&reload=${revision}`,
          platform,
          keys[platform],
          undefined,
          ctrl.signal,
        );
        const data: { slugs: string[]; sources?: Source[]; failed?: string[] } = await response.json();
        batch = data.sources ?? [];
        failedSlugs = data.failed ?? [];
        if (failedSlugs.length) errors = true;
        for (const slug of data.slugs) {
          if (data.sources) missing.delete(slug);
          else missing.add(slug);
        }
      } catch {
        discoveryFailed = errors = true;
      }
      // Pre-registry drafts remain discoverable through this browser's saved slugs.
      await mapWithConcurrency([...missing], 3, async (slug) => {
        if (ctrl.signal.aborted) return;
        try {
          const data = await (await studioRequest(base(slug), platform, keys[platform], undefined, ctrl.signal)).json();
          batch.push({ slug, platform, jobs: data.jobs });
        } catch {
          failedSlugs.push(slug);
          errors = true;
        }
      });
      if (!ctrl.signal.aborted)
        setSources((old) => [
          ...old.filter(
            (entry) =>
              entry.account ||
              entry.platform !== platform ||
              ((discoveryFailed || failedSlugs.includes(entry.slug)) && !batch.some((s) => s.slug === entry.slug)),
          ),
          ...batch,
        ]);
    }
    async function loadAccount() {
      let linked: Source[] = [];
      try {
        const response = await fetch('/api/style-gallery/generation-sources?account=1', {
          signal: ctrl.signal,
          cache: 'no-store',
          redirect: 'error',
        });
        if (!response.ok) throw Error();
        const account: { sources: Source[]; signedIn: boolean; loginEnabled: boolean } = await response.json();
        if (ctrl.signal.aborted) return;
        setCanSignIn(!account.signedIn && account.loginEnabled);
        linked = account.sources.map((source) => ({ ...source, account: true }));
      } catch {
        errors = true;
      }
      if (!ctrl.signal.aborted) setSources((old) => [...old.filter((s) => !s.account), ...linked]);
    }
    void Promise.all([loadAccount(), ...platforms.map(loadPlatform)]).then(() => {
      if (ctrl.signal.aborted) return;
      setFailed(errors);
      setBusy(false);
    });
    return () => ctrl.abort();
  }, [keys, revision]);
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const priority = (source: Source) => Number(Boolean(source.stale)) * 2 + Number(Boolean(source.account));
    return outputRows(
      [...sources]
        .sort((a, b) => priority(a) - priority(b))
        .map((source) => ({
          ...source,
          jobs: source.jobs.filter((job) => {
            const id = `${source.platform}/${source.slug}/${job.id}`;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          }),
        })),
    );
  }, [sources]);
  useEffect(() => {
    const onReturn = () => {
      if (!document.hidden) refresh((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onReturn);
    const onRestore = (e: PageTransitionEvent) => {
      if (e.persisted) onReturn();
    };
    window.addEventListener('pageshow', onRestore);
    const changed = (event: StorageEvent) => {
      if (event.key === 'gallery-generation:changed') onReturn();
    };
    window.addEventListener('storage', changed);
    const timer = rows.some((r) => r.group === 'tasks' && r.job.state === 'running') ? setInterval(onReturn, 20000) : undefined;
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('pageshow', onRestore);
      window.removeEventListener('storage', changed);
      clearInterval(timer);
    };
  }, [rows]);
  async function syncTask(row: Row) {
    setBusy(true);
    try {
      await studioRequest(base(row.slug), row.job.settings.platform, keys[row.job.settings.platform], {
        action: 'sync',
        id: row.job.id,
      });
      refresh((n) => n + 1);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  const groups = {
    pending: l('待审', '確認待ち', 'To review'),
    saved: l('已保存', '保存済み', 'Saved'),
    tasks: l('任务状态', 'タスク状況', 'Task status'),
  };
  const active = rows.filter((r) => r.group === group),
    chosen = active.find((r) => r.id === selected);
  useEffect(() => {
    try {
      localStorage.setItem(reviewPositionKey, JSON.stringify({ group, selected }));
    } catch {
      /* Browsing without storage still advances normally. */
    }
  }, [group, selected]);
  useEffect(() => {
    // Another tab may have finished the saved cursor. Wait for complete discovery
    // so a slow provider is never mistaken for a removed output.
    if (!busy && !failed && selected && !chosen) select(active[0]?.id ?? '');
  }, [busy, failed, selected, chosen, active]);
  if (!busy && !failed && !rows.length && platforms.every((p) => !keys[p]))
    return (
      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <p>{l('暂无关联到你的待审作品。', '確認できる作品はありません。', 'No review works are linked to you yet.')}</p>
        {canSignIn && (
          <a
            className={buttonClass}
            href={`/api/style-gallery/auth/github/login?returnTo=${encodeURIComponent(`${gallery}/review`)}`}
          >
            {l('用 GitHub 登录查看', 'GitHub でログイン', 'View with GitHub')}
          </a>
        )}
      </section>
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <fieldset className="flex flex-wrap gap-1" aria-label={l('作品分组', '作品グループ', 'Review groups')}>
          {(Object.keys(groups) as Group[]).map((g) => (
            <button
              type="button"
              key={g}
              className={cn(buttonClass, group === g && 'border-primary text-primary')}
              aria-pressed={group === g}
              onClick={() => {
                setGroup(g);
                select('');
                setLimit(12);
              }}
            >
              {groups[g]} · {rows.filter((r) => r.group === g).length}
            </button>
          ))}
        </fieldset>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => refresh((n) => n + 1)}>
          <RiRefreshLine />
          {l('刷新', '更新', 'Refresh')}
        </button>
      </div>
      <output className="text-muted-foreground text-sm">
        {busy ? l('正在读取生成记录…', '履歴を読み込み中…', 'Loading generation history…') : notice}
      </output>
      {failed && (
        <p role="alert">
          {l(
            '部分记录未能读取，请刷新重试。',
            '一部の記録を読み込めません。更新してください。',
            'Some records could not be loaded. Refresh to retry.',
          )}
        </p>
      )}
      {group !== 'tasks' && (
        <ReviewOutput
          pool={thumbs}
          row={chosen}
          locale={locale}
          gallery={gallery}
          credential={chosen && !chosen.account ? keys[chosen.job.settings.platform] : ''}
          onReviewed={(action) => {
            if (!chosen) return;
            setSources((old) =>
              old.map((s) =>
                s.slug === chosen.slug && s.platform === chosen.job.settings.platform
                  ? {
                      ...s,
                      jobs: s.jobs.map((j) =>
                        j.id !== chosen.job.id
                          ? j
                          : action === 'saved'
                            ? { ...j, published: [...new Set([...publishedOutputs(j), chosen.index])] }
                            : { ...j, discarded: [...new Set([...(j.discarded ?? []), chosen.index])] },
                      ),
                    }
                  : s,
              ),
            );
            const at = active.findIndex((row) => row.id === chosen.id);
            const next = active[at + 1] ?? active[at - 1];
            select((current) => (current === chosen.id ? (next?.id ?? '') : current));
            setNotice(
              action === 'discarded'
                ? l('已丢弃这张图。', '画像を破棄しました。', 'Output discarded.')
                : l('已加入对应条目的子图。', 'サブギャラリーに保存しました。', 'Saved to the source sub-gallery.'),
            );
            refresh((n) => n + 1);
          }}
        />
      )}
      {!busy && !failed && !active.length && (
        <p className="rounded-xl border border-border border-dashed p-8 text-center text-muted-foreground">
          {l('这个分组暂无作品。', 'このグループに作品はありません。', 'No works in this group.')}
        </p>
      )}
      <StyleGalleryGrid masonry={!mobile}>
        {active.slice(0, limit).map((row) => (
          <article key={row.id} className="overflow-hidden rounded-xl border border-border bg-card">
            {row.index >= 0 && (
              <button
                type="button"
                className="block w-full overflow-hidden bg-muted"
                aria-pressed={row.id === selected}
                aria-label={`${l('审图', '画像を確認', 'Review image')} ${row.slug} #${row.index + 1}`}
                onClick={() => {
                  select(row.id);
                  requestAnimationFrame(() =>
                    document.querySelector('[data-inbox-reader]')?.scrollIntoView({ block: 'start' }),
                  );
                }}
              >
                <PrivateImage
                  pool={thumbs}
                  url={`${base(row.slug)}?preview=${row.job.id}&index=${row.index}&thumb=fit`}
                  platform={row.job.settings.platform}
                  credential={row.account ? '' : keys[row.job.settings.platform]}
                />
              </button>
            )}
            <div className="space-y-1 p-3">
              <p className="flex flex-wrap justify-between gap-1 font-semibold text-sm">
                {row.job.settings.model}
                <span className="text-muted-foreground">
                  {row.index >= 0
                    ? `#${row.index + 1}`
                    : {
                        running: l('生成中', '生成中', 'Running'),
                        uncertain: l('待核实', '要確認', 'Uncertain'),
                        failed: l('生成失败', '失敗', 'Failed'),
                        ready: '',
                        saved: '',
                      }[row.job.state]}
                </span>
              </p>
              {row.group === 'tasks' && !row.account && row.job.state !== 'failed' && (
                <button type="button" className={buttonClass} disabled={busy} onClick={() => void syncTask(row)}>
                  {l('重新读取任务', 'タスクを再確認', 'Check task')}
                </button>
              )}
              <p className="line-clamp-2 break-words text-muted-foreground text-sm">{row.job.prompt}</p>
              <a className="inline-flex min-h-9 items-center gap-1 text-primary text-xs" href={`${gallery}/${row.slug}`}>
                {row.slug}
                <RiArrowRightLine />
              </a>
            </div>
          </article>
        ))}
      </StyleGalleryGrid>
      {active.length > limit && (
        <button type="button" className={buttonClass} onClick={() => setLimit((n) => n + 12)}>
          {l('加载更多', 'もっと見る', 'Load more')}
        </button>
      )}
    </div>
  );
}

export default function StyleGalleryReviewInbox({ locale, gallery }: { locale: string; gallery: string }) {
  const l = useMemo(() => studioLanguage(locale), [locale]);
  const [session, setSession] = useState<{ keys: Record<GenerationPlatform, string>; version: number }>();
  useEffect(() => {
    function restore() {
      const keys = { 'gpt-image': readProviderKey('gpt-image'), pixai: readProviderKey('pixai') };
      // Remount the private list when its owner changes, clearing the old owner's thumbnails immediately.
      setSession((previous) =>
        previous && platforms.every((p) => previous.keys[p] === keys[p])
          ? previous
          : { keys, version: (previous?.version ?? 0) + 1 },
      );
    }
    restore();
    const changed = (e: StorageEvent) => {
      if (e.key === null || e.key.startsWith('gallery-generation:key:')) restore();
    };
    window.addEventListener('pageshow', restore);
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener('pageshow', restore);
      window.removeEventListener('storage', changed);
    };
  }, []);
  if (!session) return <output>{l('正在读取工作台…', '読み込み中…', 'Loading workspace…')}</output>;
  return <Inbox key={session.version} keys={session.keys} gallery={gallery} locale={locale} />;
}
