import { Icon } from '@iconify/react';
import { getStyleGalleryManagementToken, rememberStyleGalleryManagementToken } from '@lib/style-gallery-management-token';
import {
  applyGalleryTagMutation,
  type GalleryTagMutationMode,
  getGalleryTagVocabulary,
  isValidGalleryTag,
  MAX_GALLERY_TAG_VOCABULARY,
  MAX_GALLERY_TAGS_PER_ITEM,
  normalizeGalleryTag,
} from '@lib/style-gallery-tags';
import { useStore } from '@nanostores/react';
import {
  $galleryTagEditor,
  getGalleryTagEditorSnapshot,
  invalidateGalleryTagEditorSnapshot,
  loadGalleryTags,
  publishGalleryTags,
  useGalleryTags,
} from '@store/gallery-tags';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import '@/styles/components/gallery-tags.css';

function labels(locale: string) {
  return locale.startsWith('zh')
    ? {
        tags: '标签',
        all: '全部标签',
        edit: '编辑标签',
        description: '标签属于来源风格，同组示例共享。选择已有分类，或输入新标签。',
        input: '输入或选择标签',
        suggestions: '已有标签',
        empty: '还没有标签，从第一个分类开始',
        save: '保存标签',
        cancel: '取消',
        loading: '正在读取标签…',
        login: '输入管理 token，与上传图片共用',
        failed: '标签暂时不可用，请重试',
        retry: '重试',
        remove: '移除',
        create: '创建',
        limit: '每张图最多 12 个标签，每个标签最多 24 字；null 为保留词',
        saved: '标签已保存',
        conflict: '标签已被其他会话修改，请关闭后重新打开编辑器。',
        more: '查看全部标签',
        hint: '↑ ↓ 选择 · Tab / Enter 填入',
        saving: '正在保存…',
      }
    : locale.startsWith('ja')
      ? {
          tags: 'タグ',
          all: 'すべてのタグ',
          edit: 'タグを編集',
          description: '元のスタイルに分類を追加します。同じスタイルの作例にも表示されます。',
          input: 'タグを入力または選択',
          suggestions: '既存のタグ',
          empty: '最初のタグを追加',
          save: '保存',
          cancel: 'キャンセル',
          loading: '読み込み中…',
          login: 'アップロードと共通の管理トークン',
          failed: 'タグを読み込めません',
          retry: '再試行',
          remove: '削除',
          create: '作成',
          limit: '最大12タグ、各24文字。null は予約語です',
          saved: '保存しました',
          conflict: '他のセッションで変更されました。編集画面を開き直してください。',
          more: 'すべてのタグ',
          hint: '↑ ↓ 選択 · Tab / Enter 確定',
          saving: '保存中…',
        }
      : {
          tags: 'Tags',
          all: 'All tags',
          edit: 'Edit tags',
          description:
            'Categories belong to the source style and are shared by its generated examples. Choose a category or create one.',
          input: 'Type or choose a tag',
          suggestions: 'Existing tags',
          empty: 'Add the first category',
          save: 'Save tags',
          cancel: 'Cancel',
          loading: 'Loading tags…',
          login: 'Management token, shared with image uploads',
          failed: 'Tags are unavailable. Please retry.',
          retry: 'Retry',
          remove: 'Remove',
          create: 'Create',
          limit: 'Up to 12 tags, 24 characters each; null is reserved',
          saved: 'Tags saved',
          conflict: 'Tags changed in another session. Close and reopen the editor.',
          more: 'View all tags',
          hint: '↑ ↓ select · Tab / Enter add',
          saving: 'Saving…',
        };
}

/** Bulk operations spell out their effect before any categories can be removed. */
function bulkLabels(locale: string) {
  return locale.startsWith('zh')
    ? {
        operation: '标签操作',
        add: '添加',
        remove: '移除',
        replace: '覆盖',
        addDescription: '追加选中的标签，保留每张图已有的标签。同源示例一起生效。',
        removeDescription: '仅移除选中的标签，其他标签保持不变。',
        replaceDescription: '每张图的标签都将替换为下方这一组；留空将清空全部标签。',
        impact: '{sources} 个来源将变化 · 新增 {added} 项标签 · 移除 {removed} 项标签',
        addAction: '添加标签',
        removeAction: '移除标签',
        replaceAction: '覆盖标签',
        clearAction: '清空全部标签',
        confirm: '确认应用',
        back: '返回编辑',
        review: '确认批量修改',
        unchanged: '当前设置不会改变选中图片的标签',
        empty: '选中的图片中没有匹配的标签',
      }
    : locale.startsWith('ja')
      ? {
          operation: 'タグ操作',
          add: '追加',
          remove: '削除',
          replace: '置換',
          addDescription: '選択したタグを追加し、既存のタグを保持します。同じ元画像の作例にも反映されます。',
          removeDescription: '選択したタグだけを削除します。他のタグは保持されます。',
          replaceDescription: '各画像のタグを以下の組み合わせに置換します。空欄ではすべて削除します。',
          impact: '{sources} 件を変更 · {added} 個追加 · {removed} 個削除',
          addAction: 'タグを追加',
          removeAction: 'タグを削除',
          replaceAction: 'タグを置換',
          clearAction: 'すべてのタグを削除',
          confirm: '変更を確定',
          back: '編集に戻る',
          review: '一括変更の確認',
          unchanged: '選択した画像のタグは変更されません',
          empty: '選択した画像に一致するタグがありません',
        }
      : {
          operation: 'Tag operation',
          add: 'Add',
          remove: 'Remove',
          replace: 'Replace',
          addDescription: 'Add these tags while keeping each image’s existing categories. Generated examples share the change.',
          removeDescription: 'Remove only the chosen tags. Keep all other categories.',
          replaceDescription: 'Replace every image’s tags with the set below. Leave it empty to clear all tags.',
          impact: '{sources} sources will change · {added} tag assignments added · {removed} removed',
          addAction: 'Add tags',
          removeAction: 'Remove tags',
          replaceAction: 'Replace tags',
          clearAction: 'Clear all tags',
          confirm: 'Confirm changes',
          back: 'Back to editing',
          review: 'Confirm bulk changes',
          unchanged: 'These settings will not change the selected images’ tags',
          empty: 'No matching tags on the selected images',
        };
}

/** Overlay links have their own hit targets; they never trigger the card's image navigation. */
export function GalleryTagPills({
  slug,
  locale = 'zh',
  basePath = '/image-style-prompt-gallery',
  overlay = false,
  editable = false,
  maxVisible = 2,
  onSelect,
  onNavigate,
}: {
  slug: string;
  locale?: string;
  basePath?: string;
  overlay?: boolean;
  editable?: boolean;
  maxVisible?: number;
  onSelect?: (tag: string) => void;
  onNavigate?: () => void;
}) {
  const { index } = useGalleryTags();
  const tags = index.items[slug] ?? [];
  const text = labels(locale);
  const visible = overlay ? tags.slice(0, maxVisible) : tags;
  if (!tags.length && !editable) return null;
  return (
    <nav className={`gallery-tags ${overlay ? 'gallery-tags-overlay' : ''}`} aria-label={text.tags}>
      {visible.map((tag) =>
        onSelect ? (
          <button
            type="button"
            className="gallery-tag"
            title={tag}
            key={tag}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(tag);
            }}
          >
            #{tag}
          </button>
        ) : (
          <a
            className="gallery-tag"
            title={tag}
            key={tag}
            href={`${basePath}?tag=${encodeURIComponent(tag)}`}
            data-astro-prefetch="false"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate?.();
            }}
          >
            #{tag}
          </a>
        ),
      )}
      {overlay && tags.length > visible.length && (
        <a
          className="gallery-tag"
          href={`${basePath}/${slug}`}
          title={tags.join(' · ')}
          aria-label={text.more}
          data-astro-prefetch="false"
        >
          +{tags.length - visible.length}
        </a>
      )}
      {editable && (
        <button
          type="button"
          className="gallery-tag gallery-tag-edit"
          title={text.edit}
          aria-label={text.edit}
          onClick={(e) => {
            e.stopPropagation();
            $galleryTagEditor.set(slug);
          }}
        >
          <Icon icon="ri:price-tag-3-line" className="size-3.5" />
        </button>
      )}
    </nav>
  );
}

/** Lightbox failures stay visible and recoverable instead of silently appearing as an untagged image. */
export function GalleryLightboxTags({
  slug,
  locale,
  basePath,
  onNavigate,
}: {
  slug: string;
  locale: string;
  basePath: string;
  onNavigate: () => void;
}) {
  const { status } = useGalleryTags();
  const text = labels(locale);
  if (status === 'error')
    return (
      <button
        type="button"
        className="rounded-full bg-black/70 px-3 py-2 text-white text-xs"
        onClick={() => void loadGalleryTags()}
      >
        {text.failed} · {text.retry}
      </button>
    );
  if (status !== 'ready')
    return <output className="rounded-full bg-black/70 px-3 py-2 text-white/80 text-xs">{text.loading}</output>;
  return <GalleryTagPills slug={slug} locale={locale} basePath={basePath} onNavigate={onNavigate} />;
}

/** Exact tag filters work without fetching the large prompt-search index. */
export function GalleryTagFilter({
  value,
  onChange,
  locale,
}: {
  value: string;
  onChange: (tag: string) => void;
  locale: string;
}) {
  const { index, status } = useGalleryTags();
  const text = labels(locale);
  const vocabulary = useMemo(() => getGalleryTagVocabulary(index), [index]);
  return (
    <div className="flex items-center gap-1" data-gallery-tag-filter>
      <label className="relative">
        <Icon icon="ri:price-tag-3-line" className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
        <select
          aria-label={text.tags}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 max-w-48 appearance-none rounded-md border border-border bg-background pr-7 pl-9 text-sm focus:border-primary"
          disabled={status === 'loading' || status === 'idle'}
        >
          <option value="">{status === 'loading' || status === 'idle' ? text.loading : text.all}</option>
          {value && !vocabulary.some((entry) => entry.tag === value) && <option value={value}>#{value}</option>}
          {vocabulary.map(({ tag, count }) => (
            <option value={tag} key={tag}>
              #{tag} · {count}
            </option>
          ))}
        </select>
      </label>
      {status === 'error' && (
        <button type="button" title={text.failed} onClick={() => void loadGalleryTags()} className="text-primary text-sm">
          {text.retry}
        </button>
      )}
    </div>
  );
}

/** Open from the already-loaded tag index; conditional authenticated writes prevent lost edits. */
export function GalleryTagEditor({ locale = 'zh' }: { locale?: string }) {
  const target = useStore($galleryTagEditor);
  const bulk = Array.isArray(target);
  const bulkText = bulkLabels(locale);
  const [mode, setMode] = useState<GalleryTagMutationMode>('add');
  const [confirming, setConfirming] = useState(false);
  const [baseBySlug, setBaseBySlug] = useState<Record<string, string[]>>({});
  const slug = typeof target === 'string' ? target : null;
  const [token, setToken] = useState('');
  const tokenRef = useRef('');
  const { index } = useGalleryTags();
  const text = labels(locale);
  const [tags, setTags] = useState<string[]>([]);
  const [base, setBase] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'login' | 'error' | 'saving'>('loading');
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const [attempt, setAttempt] = useState(0);
  const lastTarget = useRef<typeof target>(null);
  useEffect(() => {
    if (!target) {
      lastTarget.current = null;
      return;
    }
    if (lastTarget.current !== target) {
      tokenRef.current = getStyleGalleryManagementToken();
      setMode('add');
      setConfirming(false);
    }
    lastTarget.current = target;
    setToken(tokenRef.current);
    if (!tokenRef.current) {
      setStatus('login');
      return;
    }
    const controller = new AbortController();
    setConfirming(false);
    setStatus('loading');
    setMessage('');
    setQuery('');
    setActive(0);
    const cached = getGalleryTagEditorSnapshot();
    if (cached) {
      setTags(slug ? (cached.items[slug] ?? []) : []);
      setBase(slug ? (cached.items[slug] ?? []) : []);
      setBaseBySlug(Object.fromEntries((Array.isArray(target) ? target : []).map((id) => [id, cached.items[id] ?? []])));
      setStatus('ready');
      return () => controller.abort();
    }
    void fetch(`/api/style-gallery/tags?edit=1&attempt=${attempt}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${tokenRef.current}` },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setStatus('login');
          return;
        }
        if (!response.ok) throw new Error('Read failed');
        const next = await response.json();
        if (controller.signal.aborted) return;
        rememberStyleGalleryManagementToken(tokenRef.current);
        publishGalleryTags(next);
        setTags(slug ? (next.items[slug] ?? []) : []);
        setBase(slug ? (next.items[slug] ?? []) : []);
        setBaseBySlug(Object.fromEntries((Array.isArray(target) ? target : []).map((id) => [id, next.items[id] ?? []])));
        setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [target, slug, attempt]);
  useEffect(() => {
    if (status === 'ready' && target) (confirming ? saveButton.current : input.current)?.focus();
  }, [status, target, confirming]);
  const normalized = normalizeGalleryTag(query);
  const removal = bulk && mode === 'remove';
  const maxTags = removal ? MAX_GALLERY_TAG_VOCABULARY : MAX_GALLERY_TAGS_PER_ITEM;
  const draft = useMemo(() => (normalized ? [...new Set([...tags, normalized])] : tags), [normalized, tags]);
  const impact = useMemo(() => {
    let sources = 0,
      added = 0,
      removed = 0;
    if (bulk)
      for (const existing of Object.values(baseBySlug)) {
        const next = applyGalleryTagMutation(existing, draft, mode);
        const additions = next.filter((tag) => !existing.includes(tag)).length;
        const removals = existing.filter((tag) => !next.includes(tag)).length;
        if (additions || removals) sources++;
        added += additions;
        removed += removals;
      }
    return { sources, added, removed };
  }, [bulk, baseBySlug, draft, mode]);
  const impactText = bulkText.impact
    .replace('{sources}', String(impact.sources))
    .replace('{added}', String(impact.added))
    .replace('{removed}', String(impact.removed));
  const actionText =
    mode === 'replace'
      ? draft.length
        ? bulkText.replaceAction
        : bulkText.clearAction
      : mode === 'remove'
        ? bulkText.removeAction
        : bulkText.addAction;
  const suggestions = useMemo(
    () =>
      getGalleryTagVocabulary(removal ? { version: 1, items: baseBySlug } : index).filter(
        ({ tag }) => !tags.includes(tag) && (!normalized || tag.includes(normalized)),
      ),
    [index, baseBySlug, removal, tags, normalized],
  );
  const choices = tags.length < maxTags ? [...suggestions.map((entry) => ({ ...entry, create: false }))] : [];
  if (
    tags.length < maxTags &&
    !removal &&
    normalized &&
    !tags.includes(normalized) &&
    !suggestions.some(({ tag }) => tag === normalized)
  )
    choices.push({ tag: normalized, count: 0, create: true });
  const selected = Math.min(active, Math.max(0, choices.length - 1));
  useEffect(() => {
    if (target && status === 'ready') document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected, listId, target, status]);
  function add(tag: string) {
    if (tags.length >= maxTags || !isValidGalleryTag(tag)) {
      setMessage(text.limit);
      return;
    }
    setTags((current) => [...new Set([...current, tag])]);
    setQuery('');
    setActive(0);
    setMessage('');
    input.current?.focus();
  }
  async function save(confirmed = false) {
    if (!target || status !== 'ready') return;
    // An uncommitted draft is included rather than silently discarded by the Save button.
    if (
      (bulk && mode !== 'replace' && draft.length === 0) ||
      draft.length > maxTags ||
      draft.some((tag) => !isValidGalleryTag(tag))
    ) {
      setMessage(text.limit);
      return;
    }
    if (bulk && mode !== 'add' && !confirmed) {
      setConfirming(true);
      return;
    }
    setStatus('saving');
    setMessage('');
    try {
      const response = await fetch('/api/style-gallery/tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` },
        body: JSON.stringify(
          bulk
            ? {
                slugs: target,
                tags: draft,
                ...(mode !== 'add' ? { mode } : {}),
                ...(mode === 'replace' ? { previousTagsBySlug: baseBySlug } : {}),
              }
            : { slug, tags: draft, previousTags: base },
        ),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 401) {
        setStatus('login');
        return;
      }
      if (!response.ok) {
        if (response.status === 409) invalidateGalleryTagEditorSnapshot();
        setMessage(response.status === 409 ? text.conflict : response.status === 400 ? await response.text() : text.failed);
        setStatus('ready');
        return;
      }
      rememberStyleGalleryManagementToken(tokenRef.current);
      publishGalleryTags(await response.json());
      $galleryTagEditor.set(null);
    } catch {
      setMessage(text.failed);
      setStatus('ready');
    }
  }
  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!open && status !== 'saving') $galleryTagEditor.set(null);
      }}
    >
      <DialogContent className="gallery-tag-dialog sm:max-w-lg">
        <DialogTitle>
          {text.edit}
          {bulk ? ` · ${target.length}` : ''}
        </DialogTitle>
        <DialogDescription>{bulk ? bulkText[`${mode}Description`] : text.description}</DialogDescription>
        {status === 'loading' && <output>{text.loading}</output>}
        {status === 'login' && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              tokenRef.current = token.trim();
              setAttempt((n) => n + 1);
            }}
          >
            <label className="flex flex-col gap-2 text-sm">
              {text.login}
              <input
                type="password"
                aria-label="Management token"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="h-10 rounded-lg border border-border bg-background px-3"
              />
            </label>
            <button type="submit" disabled={!token.trim()} className="rounded-lg bg-primary p-3 text-primary-foreground">
              {text.retry}
            </button>
          </form>
        )}
        {status === 'error' && (
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            {text.failed} · {text.retry}
          </button>
        )}
        {(status === 'ready' || status === 'saving') && (
          <>
            {bulk && !confirming && (
              <fieldset className="gallery-tag-modes" disabled={status === 'saving'}>
                <legend className="sr-only">{bulkText.operation}</legend>
                {(['add', 'remove', 'replace'] as const).map((value) => (
                  <label className="gallery-tag-mode" key={value}>
                    <input
                      type="radio"
                      className="absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0"
                      name={`${listId}-mode`}
                      value={value}
                      checked={mode === value}
                      onChange={() => {
                        setMode(value);
                        setQuery('');
                        setActive(0);
                        setMessage('');
                      }}
                    />
                    <Icon
                      icon={
                        value === 'add' ? 'ri:add-line' : value === 'remove' ? 'ri:subtract-line' : 'ri:arrow-left-right-line'
                      }
                      className="size-4"
                    />
                    {bulkText[value]}
                  </label>
                ))}
              </fieldset>
            )}
            {confirming ? (
              <fieldset className="gallery-tag-review" aria-label={bulkText.review}>
                <p className="font-semibold text-sm">{actionText}</p>
                <div className="gallery-tags">
                  {draft.map((tag) => (
                    <span key={tag} className="gallery-tag">
                      #{tag}
                    </span>
                  ))}
                </div>
              </fieldset>
            ) : (
              <>
                <div className="gallery-tag-input-shell">
                  <div className="gallery-tags">
                    {tags.map((tag) => (
                      <button
                        type="button"
                        disabled={status === 'saving'}
                        key={tag}
                        className="gallery-tag"
                        aria-label={`${text.remove} ${tag}`}
                        onClick={() => setTags(tags.filter((entry) => entry !== tag))}
                      >
                        #{tag}
                        <Icon icon="ri:close-line" className="size-3.5" />
                      </button>
                    ))}
                  </div>
                  <input
                    ref={input}
                    role="combobox"
                    aria-label={text.input}
                    aria-autocomplete="list"
                    aria-expanded={choices.length > 0}
                    aria-controls={listId}
                    aria-activedescendant={choices.length ? `${listId}-${selected}` : undefined}
                    value={query}
                    maxLength={100}
                    placeholder={text.input}
                    disabled={status === 'saving'}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActive(0);
                    }}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (['ArrowDown', 'ArrowUp'].includes(e.key) && choices.length) {
                        e.preventDefault();
                        setActive((selected + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length);
                      } else if ((e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) && choices.length) {
                        e.preventDefault();
                        add(choices[selected].tag);
                      }
                    }}
                  />
                </div>
                <div className="flex justify-between text-muted-foreground text-xs">
                  <span>{text.suggestions}</span>
                  <span>{text.hint}</span>
                </div>
                <div id={listId} role="listbox" aria-label={text.suggestions} className="gallery-tag-suggestions">
                  {choices.map(({ tag, count, create }, i) => (
                    <button
                      id={`${listId}-${i}`}
                      key={tag}
                      type="button"
                      role="option"
                      aria-selected={selected === i}
                      tabIndex={-1}
                      disabled={status === 'saving'}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => add(tag)}
                      className="gallery-tag-option"
                    >
                      <span>
                        {create ? `${text.create} ` : ''}#{tag}
                      </span>
                      <span className="text-muted-foreground text-xs">{selected === i ? 'Tab' : count || '+'}</span>
                    </button>
                  ))}
                  {!choices.length && (
                    <p className="p-3 text-muted-foreground text-sm">
                      {removal ? bulkText.empty : tags.length ? text.limit : text.empty}
                    </p>
                  )}
                </div>
              </>
            )}
            {bulk && (
              <output className="text-muted-foreground text-xs" data-gallery-tag-impact>
                {impact.sources ? impactText : bulkText.unchanged}
              </output>
            )}
            {message && (
              <p role="alert" className="text-destructive text-sm">
                {message}
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground text-xs">
                {draft.length} / {maxTags}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-border px-4 py-2 text-sm"
                  disabled={status === 'saving'}
                  onClick={() => (confirming ? setConfirming(false) : $galleryTagEditor.set(null))}
                >
                  {confirming ? bulkText.back : text.cancel}
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-primary px-4 py-2 text-primary-foreground text-sm"
                  disabled={status === 'saving' || (bulk && !impact.sources)}
                  ref={saveButton}
                  onClick={() => void save(confirming)}
                >
                  {status === 'saving' ? text.saving : confirming ? bulkText.confirm : bulk ? actionText : text.save}
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
