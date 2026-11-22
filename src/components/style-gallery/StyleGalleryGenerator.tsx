import {
  availableOutputs,
  defaultSettings,
  type GenerationJob,
  type GenerationPlatform,
  type GenerationSettings,
  generationCaption,
  generationSettings,
  publishedOutputs,
} from '@lib/style-gallery-generation-settings';
import { getStyleGalleryManagementToken, rememberStyleGalleryManagementToken } from '@lib/style-gallery-management-token';
import { STYLE_GALLERY_PLATFORMS } from '@lib/style-gallery-platforms';
import {
  getSelectedStyleGalleryPrompt,
  STYLE_GALLERY_PROMPT_SELECTED_EVENT,
  type StyleGalleryPromptSelectedDetail,
} from '@lib/style-gallery-prompt-selection';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RiAddLine,
  RiDownload2Line,
  RiHistoryLine,
  RiImage2Line,
  RiImageAddLine,
  RiLoader4Line,
  RiMagicLine,
  RiPencilLine,
  RiRestartLine,
  RiSparkling2Line,
  RiSubtractLine,
} from 'react-icons/ri';
import type { StyleGalleryExample, StyleGalleryImageRef } from '@/types/style-gallery';
import { GenerationFields, studioLanguage } from './StyleGalleryGenerationFields';
import { GenerationViewer } from './StyleGalleryGenerationViewer';
import { OutputStrip } from './StyleGalleryOutputStrip';
import './gallery-generator.css';

interface Props {
  slug: string;
  prompt: string;
  locale: string;
  refs: StyleGalleryImageRef[];
  accessEnabled: boolean;
  onSaved: (examples: StyleGalleryExample[]) => void;
}
function labels(locale: string) {
  const l = (zh: string, ja: string, en: string) => (locale.startsWith('zh') ? zh : locale.startsWith('ja') ? ja : en);
  return {
    title: l('用此提示词生图', 'このプロンプトで生成', 'Generate from this prompt'),
    prompt: l('提示词', 'プロンプト', 'Prompt'),
    provider: l('生成平台', '生成サービス', 'Provider'),
    model: l('模型', 'モデル', 'Model'),
    size: l('尺寸', 'サイズ', 'Size'),
    ratio: l('画幅', '縦横比', 'Aspect ratio'),
    quality: l('质量', '品質', 'Quality'),
    untested: l('未测试', '未検証', 'Untested'),
    accessDisabled: l(
      '服务器尚未启用图库上传权限。',
      'サーバーでアップロード権限を設定してください。',
      'Gallery uploads are disabled on this server.',
    ),
    submitting: l('正在提交…', '送信中…', 'Submitting…'),
    generate: l('生成一张', '1 枚生成', 'Generate one image'),
    preview: l('结果预览', 'プレビュー', 'Result preview'),
    token: l('上传令牌', 'アップロードトークン', 'Upload token'),
    unlock: l('连接工作台', '接続する', 'Connect studio'),
    history: l('生成记录', '生成履歴', 'Generation history'),
    empty: l('生成的图片将在这里预览', '生成画像をここに表示します', 'Your image will appear here'),
    confirm: l('确认加入子图', 'サブギャラリーに保存', 'Add to sub-gallery'),
    saving: l('正在保存…', '保存中…', 'Saving…'),
    hint: l(
      '可离开页面，返回后在生成记录中继续。',
      'ページを閉じても履歴から再開できます。',
      'You can leave this page and return to your generation history.',
    ),
    running: l('正在生成', '生成中', 'Generating'),
    ready: l('待确认', '確認待ち', 'Ready for review'),
    saved: l('已加入子图', '保存済み', 'Added to sub-gallery'),
    failed: l('生成失败', '生成失敗', 'Generation failed'),
    uncertain: l('提交结果待核实，未自动重试', '結果未確認・自動再送なし', 'Outcome unknown. No automatic resubmission.'),
    retry: l('重新读取', '再読み込み', 'Reload result'),
    record: l('本次生成提示词', '使用したプロンプト', 'Submitted prompt'),
    reconnect: l('请求未完成，可重新读取记录。', '履歴を再読み込みしてください。', 'Request interrupted. Reload the history.'),
    validating: l('正在连接…', '接続中…', 'Connecting…'),
  };
}

const fieldClass = 'w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground text-sm';
/** The editor is mounted on demand. Its private history is fetched only after authentication. */
export default function StyleGalleryGenerator(props: Props) {
  const [open, setOpen] = useState(false);
  const title = labels(props.locale).title;
  const ToggleIcon = open ? RiSubtractLine : RiAddLine;
  return (
    <section className="gallery-generator rounded-xl border border-border bg-card" aria-label={title}>
      <button type="button" className="studio-heading" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="studio-icon">
          <RiMagicLine aria-hidden="true" />
        </span>
        <span>{title}</span>
        <ToggleIcon aria-hidden="true" className="ml-auto size-5 text-muted-foreground" />
      </button>
      {open && <StudioSession key={props.slug} {...props} />}
    </section>
  );
}

const sessionKeys = new Map<GenerationPlatform, string>();
function readProviderKey(platform: GenerationPlatform) {
  try {
    return localStorage.getItem(`gallery-generation:key:${platform}`) ?? '';
  } catch {
    return sessionKeys.get(platform) ?? '';
  }
}
function rememberProviderKey(platform: GenerationPlatform, value: string) {
  sessionKeys.set(platform, value);
  try {
    const name = `gallery-generation:key:${platform}`;
    if (value) localStorage.setItem(name, value);
    else localStorage.removeItem(name);
  } catch {
    /* Storage-restricted browsers can still generate in this tab. */
  }
}

/** Remount the private review surface when switching credentials so jobs and object URLs cannot cross accounts. */
function StudioSession(props: Props) {
  const [platform, switchPlatform] = useState<GenerationPlatform>(() => {
    try {
      return JSON.parse(localStorage.getItem(`gallery-generation:${props.slug}`) ?? 'null')?.settings?.platform === 'pixai'
        ? 'pixai'
        : 'gpt-image';
    } catch {
      return 'gpt-image';
    }
  });
  const [revision, reset] = useState(0);
  return (
    <Editor
      key={`${platform}:${revision}`}
      {...props}
      platform={platform}
      switchPlatform={switchPlatform}
      forget={() => {
        rememberProviderKey(platform, '');
        reset((n) => n + 1);
      }}
    />
  );
}

async function studioRequest(
  url: string,
  platform: GenerationPlatform,
  apiKey: string,
  body?: object,
  signal?: AbortSignal,
  uploadToken?: string,
  invalidUploadMessage?: string,
) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    redirect: 'error',
    signal,
    headers: {
      'x-gallery-provider': platform,
      'x-api-key': apiKey,
      ...(uploadToken && { authorization: `Bearer ${uploadToken}` }),
      ...(body && { 'content-type': 'application/json' }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (response.status === 403 && data?.code === 'invalid_upload_token' && invalidUploadMessage)
      throw new Error(invalidUploadMessage);
    throw new Error(data?.error ?? `HTTP ${response.status}`);
  }
  return response;
}

function Editor({
  slug,
  prompt,
  locale,
  platform,
  switchPlatform,
  forget,
  accessEnabled,
  refs,
  onSaved,
}: Props & {
  platform: GenerationPlatform;
  switchPlatform: (platform: GenerationPlatform) => void;
  forget: () => void;
}) {
  const copy = labels(locale);
  const l = studioLanguage(locale);
  const [view, setView] = useState<'edit' | 'review'>('edit');
  const [outputIndex, selectOutput] = useState(0);
  const base = `/api/style-gallery/generations/${encodeURIComponent(slug)}`;
  const draftKey = `gallery-generation:${slug}`;
  const [settings, setSettings] = useState<GenerationSettings>(() => defaultSettings(platform));
  const [text, setText] = useState(prompt);
  const [hydrated, setHydrated] = useState(false);
  const requestKey = `${draftKey}:${platform}:request`;
  const [uploadToken, setUploadToken] = useState(getStyleGalleryManagementToken);
  const [credential, setCredential] = useState('');
  const [token, setToken] = useState('');
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [revision, refresh] = useState(0);
  const [preview, setPreview] = useState<{ id: string; index: number; url: string; file: File }>();
  const lock = useRef(false);
  const pending = useRef<{ id: string; signature: string } | null>(null);
  const current = jobs.find((j) => j.id === selected) ?? jobs[0];
  const id = current?.id;
  const state = current?.state;
  const available = current ? availableOutputs(current) : [];
  const index = available.includes(outputIndex) ? outputIndex : (available[0] ?? 0);
  const hasImage = available.includes(index);
  const isSaved = current && publishedOutputs(current).includes(index);
  const restoreView = useRef(false);
  const historyRevision = useRef(0);

  const loadHistory = useCallback(
    async (auth: string, signal?: AbortSignal) => {
      const attempt = ++historyRevision.current;
      const result: { jobs: GenerationJob[] } = await (await studioRequest(base, platform, auth, undefined, signal)).json();
      if (signal?.aborted || attempt !== historyRevision.current) return false;
      setJobs(result.jobs);
      if (!restoreView.current && result.jobs.length) {
        setView('review');
        restoreView.current = true;
      }
      setToken(auth);
      const acknowledged = result.jobs.find((job) => job.id === pending.current?.id);
      if (acknowledged) {
        setSelected(acknowledged.id);
        pending.current = null;
        try {
          localStorage.removeItem(requestKey);
        } catch {
          /* Optional client receipt. */
        }
      }
      return true;
    },
    [base, requestKey, platform],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    const active = getSelectedStyleGalleryPrompt(slug) ?? prompt;
    setText(active);
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
      if (typeof draft?.text === 'string' && (!getSelectedStyleGalleryPrompt(slug) || draft.source === active))
        setText(draft.text);
      const parsed = generationSettings.safeParse(draft?.settings);
      if (parsed.success && parsed.data.platform === platform) setSettings(parsed.data);
      pending.current = JSON.parse(localStorage.getItem(requestKey) ?? 'null');
    } catch {
      /* Private history remains accessible when browser storage is unavailable. */
    }
    const remembered = readProviderKey(platform);
    if (remembered)
      void loadHistory(remembered, ctrl.signal).catch((e) => {
        if (!ctrl.signal.aborted) setError(e.message);
      });
    setCredential(remembered);
    setHydrated(true);
    const select = (e: Event) => {
      const d = (e as CustomEvent<StyleGalleryPromptSelectedDetail>).detail;
      if (d.slug === slug) setText(d.prompt);
    };
    window.addEventListener(STYLE_GALLERY_PROMPT_SELECTED_EVENT, select);
    return () => {
      ctrl.abort();
      window.removeEventListener(STYLE_GALLERY_PROMPT_SELECTED_EVENT, select);
    };
  }, [draftKey, requestKey, slug, prompt, platform, loadHistory]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ text, settings, source: getSelectedStyleGalleryPrompt(slug) ?? prompt }));
    } catch {
      /* Optional local editor draft. */
    }
  }, [text, settings, draftKey, hydrated, slug, prompt]);

  const request = useCallback(
    (path: string, body?: object, signal?: AbortSignal) => studioRequest(base + path, platform, token, body, signal),
    [base, platform, token],
  );
  const upsert = useCallback(
    (job: GenerationJob) =>
      setJobs((old) => [job, ...old.filter((j) => j.id !== job.id)].sort((a, b) => b.created.localeCompare(a.created))),
    [],
  );

  useEffect(() => {
    if (!token || !id) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      if (state !== 'running' && state !== 'uncertain') return;
      const { job } = await (await request('', { action: 'sync', id }, ctrl.signal)).json();
      if (ctrl.signal.aborted) return;
      upsert(job);
      if (job.state === 'running') timer = setTimeout(tick, 5000);
    }
    function tick() {
      load().catch((e) => {
        if (!ctrl.signal.aborted) {
          setError(e.message);
          if (state === 'running') timer = setTimeout(tick, 10000);
        }
      });
    }
    // Explicit reload also retries a failed preview when the job state has not changed.
    if (revision > 0) setError('');
    tick();
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [id, state, request, token, upsert, revision]);

  useEffect(() => {
    setPreview(undefined);
    if (!id || !token || !hasImage || view !== 'review') return;
    const ctrl = new AbortController();
    let url = '';
    void request(`?preview=${id}&index=${index}&reload=${revision}`, undefined, ctrl.signal)
      .then((r) => r.blob())
      .then((blob) => {
        if (ctrl.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setPreview({ id, index, url, file: new File([blob], 'generated-image', { type: blob.type }) });
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e.message);
      });
    return () => {
      ctrl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, index, token, request, hasImage, view, revision]);

  async function act(kind: string, run: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(kind);
    setError('');
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.reconnect);
    } finally {
      setBusy('');
      lock.current = false;
    }
  }
  async function connect() {
    const auth = credential.trim();
    if (!(await loadHistory(auth))) return;
    rememberProviderKey(platform, auth);
    setCredential('');
  }
  async function create() {
    const parsed = generationSettings.safeParse(settings);
    if (!parsed.success)
      throw new Error(
        l(
          '请检查当前模型的参数、种子或参考图 ID。',
          'モデルの設定と参照 ID を確認してください。',
          'Check model settings, seed and reference IDs.',
        ),
      );
    const signature = JSON.stringify({ text, settings });
    if (pending.current?.signature !== signature) pending.current = { id: crypto.randomUUID(), signature };
    const operation = pending.current;
    try {
      localStorage.setItem(requestKey, JSON.stringify(operation));
    } catch {
      /* Manifest is authoritative. */
    }
    const { job } = await (await request('', { action: 'create', id: operation.id, prompt: text, settings })).json();
    upsert(job);
    setSelected(job.id);
    selectOutput(0);
    setView('review');
    pending.current = null;
    try {
      localStorage.removeItem(requestKey);
    } catch {
      /* An old ID can only replay the same reservation. */
    }
  }
  async function confirm() {
    if (!preview || preview.id !== id || import.meta.env.SSR) return;
    const digest = await crypto.subtle.digest('SHA-256', await preview.file.arrayBuffer());
    const imageHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    const data = await (
      await studioRequest(
        base,
        platform,
        token,
        { action: 'confirm', id, index, imageHash },
        undefined,
        uploadToken.trim(),
        l(
          '上传令牌与当前图库不匹配。请检查是否使用了当前环境的令牌，然后重新保存。生成结果已保留。',
          'このギャラリーのアップロードトークンを確認して再度保存してください。生成結果は保持されています。',
          'Check the upload token for this gallery environment and save again. Your generated result is retained.',
        ),
      )
    ).json();
    rememberStyleGalleryManagementToken(uploadToken);
    onSaved(data.examples);
    await loadHistory(token);
  }
  const activePreview = preview?.id === id && preview?.index === index ? preview : undefined;
  const selectedReference =
    refs.find((ref) => current?.settings.platform === 'gpt-image' && ref.imageHash === current.settings.referenceHash) ??
    refs[0];
  const refImage = selectedReference?.sourceImage;
  const showReference = !current;
  const shownImage = showReference ? refImage : activePreview?.url;
  const refLabel = l('条目参考图', '元画像', 'Reference image');
  const editLabel = l('创作设置', '生成設定', 'Create');
  const selectJob = (jobId: string) => {
    setSelected(jobId);
    selectOutput(0);
  };
  const count = settings.count ?? 1;
  const generate = count === 1 ? copy.generate : l(`生成 ${count} 张`, `${count} 枚生成`, `Generate ${count} images`);
  return (
    <div className="studio-body">
      <nav className="studio-tabs" aria-label={copy.title}>
        <button type="button" aria-pressed={view === 'edit'} onClick={() => setView('edit')}>
          <RiPencilLine />
          {editLabel}
        </button>
        <button type="button" aria-pressed={view === 'review'} onClick={() => setView('review')}>
          <RiHistoryLine />
          {copy.history}
          {jobs.length > 0 && <span>{jobs.length}</span>}
        </button>
      </nav>
      {view === 'edit' && (
        <div className="studio-controls">
          <fieldset className="min-w-0">
            <legend>{copy.provider}</legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {STYLE_GALLERY_PLATFORMS.map((p) => {
                const supported = p.slug === 'pixai' || p.slug === 'gpt-image';
                return (
                  <button
                    type="button"
                    key={p.slug}
                    disabled={!supported || Boolean(busy)}
                    aria-pressed={settings.platform === p.slug}
                    className="studio-chip"
                    onClick={() => {
                      if (supported && p.slug !== settings.platform) switchPlatform(p.slug);
                    }}
                  >
                    {p.label}
                    {!supported && <small>{copy.untested}</small>}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className="grid gap-1.5">
            {copy.prompt}
            <textarea
              rows={6}
              maxLength={32000}
              className={`${fieldClass} resize-y leading-relaxed`}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <GenerationFields settings={settings} change={setSettings} refs={refs} l={l} />
          <button type="button" className="studio-secondary" onClick={() => setSettings(defaultSettings(platform))}>
            <RiRestartLine />
            {l('恢复默认参数', '既定の設定に戻す', 'Restore default settings')}
          </button>
          <div className="studio-keyring">
            {token ? (
              <>
                <div>
                  <strong>{platform === 'pixai' ? 'PixAI' : 'OpenAI'} API Key</strong>
                  <small>{l('已在此浏览器记住', 'このブラウザに保存済み', 'Saved in this browser')}</small>
                </div>
                <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={forget}>
                  {l('清除此密钥', 'このキーを削除', 'Forget this key')}
                </button>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act('connect', connect);
                }}
                className="flex w-full flex-wrap items-end gap-2"
              >
                <label className="grid min-w-0 flex-1 gap-1.5">
                  {platform === 'pixai' ? 'PixAI' : 'OpenAI'} API Key
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={2048}
                    className={fieldClass}
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                  />
                </label>
                <button type="submit" className="studio-secondary" disabled={!credential.trim() || Boolean(busy)}>
                  {busy === 'connect' ? copy.validating : copy.unlock}
                </button>
                {readProviderKey(platform) && (
                  <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={forget}>
                    {l('清除此密钥', 'このキーを削除', 'Forget this key')}
                  </button>
                )}
                <small className="w-full">
                  {l(
                    '密钥将记在此浏览器。生成费用由你的平台账户承担。',
                    'キーはこのブラウザに保存されます。生成料金はご自身のアカウントに請求されます。',
                    'Your key is saved in this browser. Generation is billed to your provider account.',
                  )}
                </small>
              </form>
            )}
          </div>
          <div className="studio-actionbar">
            <div>
              <strong>{settings.model}</strong>
              <small>{copy.hint}</small>
            </div>
            <button
              type="button"
              className="studio-primary"
              disabled={!token || !text.trim() || Boolean(busy) || state === 'running'}
              onClick={() => act('create', create)}
            >
              <RiSparkling2Line aria-hidden="true" />
              {busy === 'create' ? copy.submitting : generate}
            </button>
          </div>
        </div>
      )}
      {view === 'review' && (
        <div className="studio-results">
          <div className="studio-proof-heading">
            <div>
              <h3>{showReference ? refLabel : copy.preview}</h3>
              {current && <small>{generationCaption(current.settings)}</small>}
            </div>
            {jobs.length > 0 && (
              <select
                aria-label={copy.history}
                className="studio-history"
                value={id}
                onChange={(e) => selectJob(e.target.value)}
              >
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {new Date(j.created).toLocaleString(locale)} · {j.settings.model} · {copy[j.state]}
                  </option>
                ))}
              </select>
            )}
          </div>
          {shownImage ? (
            <GenerationViewer
              key={shownImage}
              src={shownImage}
              alt={showReference ? refLabel : copy.preview}
              locale={locale}
              references={activePreview ? refs : undefined}
              initialHash={selectedReference?.imageHash}
            />
          ) : (
            <div className="studio-canvas" aria-busy={state === 'running'}>
              <output className="studio-placeholder">
                {state === 'running' ? <RiLoader4Line className="studio-spin" /> : <RiImage2Line />}
                <span>{current ? copy[current.state] : copy.empty}</span>
              </output>
            </div>
          )}
          {available.length > 1 && current && (
            <OutputStrip
              indices={available}
              published={publishedOutputs(current)}
              selected={index}
              select={selectOutput}
              locale={locale}
              jobId={current.id}
              request={request}
            />
          )}
          <div className="studio-proof-tools">
            {activePreview && !showReference && (
              <a
                className="studio-secondary"
                href={activePreview.url}
                download={`${slug}-${id}-${index + 1}.${activePreview.file.type.split('/')[1] ?? 'png'}`}
              >
                <RiDownload2Line />
                {l('下载原图', '原寸画像を保存', 'Download')}
              </a>
            )}
          </div>
          {current && (
            <div className="studio-receipt">
              <details>
                <summary>{copy.record}</summary>
                <p>{current.prompt}</p>
              </details>
              <button
                type="button"
                className="studio-secondary"
                onClick={() => {
                  setSettings(current.settings);
                  setText(current.prompt);
                  setView('edit');
                }}
              >
                <RiRestartLine />
                {l('复用参数', '設定を再利用', 'Reuse settings')}
              </button>
            </div>
          )}
          <div className="studio-actionbar">
            <div>
              <strong>
                <output>{isSaved ? copy.saved : current ? copy[current.state] : copy.empty}</output>
              </strong>
              {token && <small>{copy.hint}</small>}
              {current?.error && <p>{current.error}</p>}
            </div>
            {hasImage &&
              !isSaved &&
              (accessEnabled ? (
                <div className="studio-publish">
                  <label className="grid min-w-0 gap-1">
                    {copy.token}
                    <input
                      type="password"
                      autoComplete="off"
                      className={fieldClass}
                      value={uploadToken}
                      onChange={(e) => setUploadToken(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!uploadToken.trim() || !activePreview || Boolean(busy) || showReference}
                    className="studio-primary"
                    onClick={() => act('confirm', confirm)}
                  >
                    <RiImageAddLine />
                    {busy === 'confirm' ? copy.saving : copy.confirm}
                  </button>
                </div>
              ) : (
                <p>{copy.accessDisabled}</p>
              ))}
          </div>
        </div>
      )}
      {(error || state === 'uncertain') && (
        <div className="studio-error" aria-live="polite">
          {error}{' '}
          <button
            type="button"
            className="underline"
            onClick={() =>
              act('reload', async () => {
                if (token) {
                  await loadHistory(token);
                  refresh((r) => r + 1);
                } else if (credential.trim()) await connect();
              })
            }
          >
            {copy.retry}
          </button>
        </div>
      )}
    </div>
  );
}
