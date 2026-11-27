import { mapWithConcurrency } from '@lib/map-with-concurrency';
import {
  availableOutputs,
  type GenerationJob,
  type GenerationPlatform,
  generationCaption,
  publishedOutputs,
} from '@lib/style-gallery-generation-settings';
import { getStyleGalleryManagementToken, rememberStyleGalleryManagementToken } from '@lib/style-gallery-management-token';
import { confirmStudioOutput, legacyStudioSources, readProviderKey, studioRequest } from '@lib/style-gallery-studio-client';
import { cn } from '@lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RiArrowRightLine, RiCheckLine, RiRefreshLine } from 'react-icons/ri';
import type { StyleGalleryImageRef } from '@/types/style-gallery';
import { studioLanguage } from './StyleGalleryGenerationFields';
import { GenerationViewer } from './StyleGalleryGenerationViewer';
import './gallery-generator.css';

const platforms = ['gpt-image', 'pixai'] as const;
type Group = 'pending' | 'saved' | 'tasks';
type Source = { slug: string; platform: GenerationPlatform; jobs: GenerationJob[] };
type Row = { slug: string; job: GenerationJob; index: number; group: Group; id: string };
const base = (slug: string) => `/api/style-gallery/generations/${encodeURIComponent(slug)}`;
const inputClass = 'min-h-11 min-w-0 rounded-lg border border-border bg-background px-3';
const buttonClass =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:border-primary disabled:opacity-50';

function outputRows(sources: Source[]) {
  const rows: Row[] = [];
  for (const { jobs, slug, platform } of sources)
    for (const job of jobs) {
      const available = availableOutputs(job),
        saved = publishedOutputs(job);
      for (const index of available)
        rows.push({
          slug,
          job,
          index,
          group: saved.includes(index) ? 'saved' : 'pending',
          id: [platform, slug, job.id, index].join('/'),
        });
      if (available.length < (job.settings.count ?? 1))
        rows.push({ slug, job, index: -1, group: 'tasks', id: [platform, slug, job.id, 'task'].join('/') });
    }
  return rows.sort((a, b) => b.job.created.localeCompare(a.job.created) || a.id.localeCompare(b.id));
}

/** Thumbnails use private request headers; revoke each blob URL when its row leaves the current group. */
function PrivateImage({ url, platform, credential }: { url: string; platform: GenerationPlatform; credential: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const ctrl = new AbortController();
    let objectUrl = '';
    void studioRequest(url, platform, credential, undefined, ctrl.signal)
      .then((r) => r.blob())
      .then((blob) => {
        if (ctrl.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {});
    return () => {
      ctrl.abort();
      URL.revokeObjectURL(objectUrl);
    };
  }, [url, platform, credential]);
  return src ? <img src={src} alt="" className="h-full w-full object-cover" /> : null;
}

function ReviewOutput({
  row,
  credential,
  locale,
  gallery,
  onSaved,
}: {
  row: Row;
  credential: string;
  locale: string;
  gallery: string;
  onSaved: () => void;
}) {
  const l = useMemo(() => studioLanguage(locale), [locale]);
  const [reference, setReference] = useState<StyleGalleryImageRef[]>([]);
  const [preview, setPreview] = useState<{ blob: Blob; url: string }>();
  const [token, setToken] = useState(getStyleGalleryManagementToken);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const [refError, setRefError] = useState(false);
  const lock = useRef(false);
  const { job, slug, index } = row;
  useEffect(() => {
    const ctrl = new AbortController();
    let objectUrl = '';
    setError('');
    setPreview(undefined);
    setRefError(false);
    void studioRequest(
      `${base(slug)}?preview=${job.id}&index=${index}&reload=${retry}`,
      job.settings.platform,
      credential,
      undefined,
      ctrl.signal,
    )
      .then((r) => r.blob())
      .then((blob) => {
        if (ctrl.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ blob, url: objectUrl });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setError(l('原图暂时无法读取。', '原画を読み込めません。', 'Original unavailable.'));
      });
    void fetch(`/api/style-gallery/prompts/${slug}`, { signal: ctrl.signal })
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
      URL.revokeObjectURL(objectUrl);
    };
  }, [slug, job.id, index, job.settings.platform, credential, retry, l]);
  async function save() {
    if (!preview || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
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
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section data-inbox-reader className="gallery-generator scroll-mt-24 space-y-4 rounded-xl border border-border bg-card p-4">
      {preview ? (
        <GenerationViewer
          src={preview.url}
          alt={l('生成结果', '生成結果', 'Generated result')}
          locale={locale}
          references={reference}
          initialHash={job.settings.platform === 'gpt-image' ? job.settings.referenceHash : undefined}
        />
      ) : (
        !error && <output>{l('正在读取原图…', '原画を読み込み中…', 'Loading original…')}</output>
      )}
      {refError && (
        <p>
          {l('参考图读取失败', '参照画像を読み込めません', 'Reference unavailable')}{' '}
          <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>
            {l('重试', '再試行', 'Retry')}
          </button>
        </p>
      )}
      <a className="inline-flex items-center gap-1 text-primary text-sm" href={`${gallery}/${slug}`}>
        {slug}
        <RiArrowRightLine />
      </a>
      <details>
        <summary className="cursor-pointer font-semibold">
          {l('生成提示词与参数', 'プロンプトと設定', 'Prompt and settings')}
        </summary>
        <p className="my-2 text-muted-foreground">{generationCaption(job.settings)}</p>
        <p className="whitespace-pre-wrap break-words">{job.prompt}</p>
      </details>
      {row.group === 'pending' && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
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
            {busy ? l('正在保存…', '保存中…', 'Saving…') : l('确认加入子图', 'サブギャラリーに保存', 'Add to sub-gallery')}
          </button>
        </form>
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          {!preview && (
            <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>
              {l('重试', '再試行', 'Retry')}
            </button>
          )}
        </p>
      )}
    </section>
  );
}

function Inbox({ keys, locale, gallery }: { keys: Record<GenerationPlatform, string>; locale: string; gallery: string }) {
  const l = useMemo(() => studioLanguage(locale), [locale]);
  const [sources, setSources] = useState<Source[]>([]),
    [revision, refresh] = useState(0),
    [busy, setBusy] = useState(true),
    [failed, setFailed] = useState(false);
  const [group, setGroup] = useState<Group>('pending'),
    [selected, select] = useState(''),
    [limit, setLimit] = useState(12),
    [notice, setNotice] = useState('');
  useEffect(() => {
    const ctrl = new AbortController();
    setBusy(true);
    setFailed(false);
    async function load() {
      const batch: Source[] = [];
      let errors = false;
      for (const platform of platforms) {
        if (!keys[platform] || ctrl.signal.aborted) continue;
        const slugs = new Set(legacyStudioSources(platform));
        try {
          const data = await (
            await studioRequest(
              `/api/style-gallery/generation-sources?reload=${revision}`,
              platform,
              keys[platform],
              undefined,
              ctrl.signal,
            )
          ).json();
          for (const slug of data.slugs) slugs.add(slug);
        } catch {
          errors = true;
        }
        // Limit fan-out when an old browser contains drafts for many unrelated gallery items.
        await mapWithConcurrency([...slugs], 3, async (slug) => {
          if (ctrl.signal.aborted) return;
          try {
            const data = await (await studioRequest(base(slug), platform, keys[platform], undefined, ctrl.signal)).json();
            batch.push({ slug, platform, jobs: data.jobs });
          } catch {
            errors = true;
          }
        });
      }
      if (ctrl.signal.aborted) return;
      setSources((old) =>
        errors ? [...batch, ...old.filter((s) => !batch.some((b) => b.slug === s.slug && b.platform === s.platform))] : batch,
      );
      setFailed(errors);
      setBusy(false);
    }
    void load();
    return () => ctrl.abort();
  }, [keys, revision]);
  const rows = useMemo(() => outputRows(sources), [sources]);
  useEffect(() => {
    const onReturn = () => {
      if (!document.hidden) refresh((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('pageshow', onReturn);
    const changed = (event: StorageEvent) => {
      if (event.key === 'gallery-generation:changed') onReturn();
    };
    window.addEventListener('storage', changed);
    const timer = rows.some((r) => r.group === 'tasks' && r.job.state === 'running') ? setInterval(onReturn, 20000) : undefined;
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('pageshow', onReturn);
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
      {chosen && (
        <ReviewOutput
          key={chosen.id}
          row={chosen}
          locale={locale}
          gallery={gallery}
          credential={keys[chosen.job.settings.platform]}
          onSaved={() => {
            setSources((old) =>
              old.map((s) =>
                s.slug === chosen.slug && s.platform === chosen.job.settings.platform
                  ? {
                      ...s,
                      jobs: s.jobs.map((j) =>
                        j.id === chosen.job.id ? { ...j, published: [...new Set([...publishedOutputs(j), chosen.index])] } : j,
                      ),
                    }
                  : s,
              ),
            );
            select('');
            setNotice(l('已加入对应条目的子图。', 'サブギャラリーに保存しました。', 'Saved to the source sub-gallery.'));
            refresh((n) => n + 1);
          }}
        />
      )}
      {!busy && !failed && !active.length && (
        <p className="rounded-xl border border-border border-dashed p-8 text-center text-muted-foreground">
          {l('这个分组暂无作品。', 'このグループに作品はありません。', 'No works in this group.')}
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
        {active.slice(0, limit).map((row) => (
          <article key={row.id} className="overflow-hidden rounded-xl border border-border bg-card">
            {row.index >= 0 && (
              <button
                type="button"
                className="block aspect-[4/3] w-full overflow-hidden bg-muted"
                aria-label={`${l('审图', '画像を確認', 'Review image')} ${row.slug} #${row.index + 1}`}
                onClick={() => {
                  select(row.id);
                  requestAnimationFrame(() =>
                    document.querySelector('[data-inbox-reader]')?.scrollIntoView({ block: 'start' }),
                  );
                }}
              >
                <PrivateImage
                  url={`${base(row.slug)}?preview=${row.job.id}&index=${row.index}&thumb=1`}
                  platform={row.job.settings.platform}
                  credential={keys[row.job.settings.platform]}
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
              {row.group === 'tasks' && row.job.state !== 'failed' && (
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
      </div>
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
  if (platforms.every((p) => !session.keys[p]))
    return (
      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <p>
          {l(
            '这个浏览器还没有关联的生图记录。',
            'このブラウザーには生成履歴がありません。',
            'No generation workspace is connected to this browser.',
          )}
        </p>
        <a className={buttonClass} href={gallery}>
          {l('浏览图库', 'ギャラリーを見る', 'Browse gallery')}
        </a>
      </section>
    );
  return <Inbox key={session.version} keys={session.keys} gallery={gallery} locale={locale} />;
}
