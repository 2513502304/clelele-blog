import { Icon } from '@iconify/react';
import { getStyleGalleryManagementToken, rememberStyleGalleryManagementToken } from '@lib/style-gallery-management-token';
import {
  getGalleryTagVocabulary,
  isValidGalleryTag,
  MAX_GALLERY_TAGS_PER_ITEM,
  normalizeGalleryTag,
} from '@lib/style-gallery-tags';
import { useStore } from '@nanostores/react';
import { $galleryTagEditor, loadGalleryTags, publishGalleryTags, useGalleryTags } from '@store/gallery-tags';
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

/** One editor host per gallery page. Fresh snapshots plus base-tag comparison prevent lost edits. */
export function GalleryTagEditor({ locale = 'zh' }: { locale?: string }) {
  const target = useStore($galleryTagEditor);
  const bulk = Array.isArray(target);
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
  const listId = useId();
  const [attempt, setAttempt] = useState(0);
  const lastTarget = useRef<typeof target>(null);
  useEffect(() => {
    if (!target) {
      lastTarget.current = null;
      return;
    }
    if (lastTarget.current !== target) tokenRef.current = getStyleGalleryManagementToken();
    lastTarget.current = target;
    setToken(tokenRef.current);
    if (!tokenRef.current) {
      setStatus('login');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    setMessage('');
    setQuery('');
    setActive(0);
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
        setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [target, slug, attempt]);
  useEffect(() => {
    if (status === 'ready' && target) input.current?.focus();
  }, [status, target]);
  const normalized = normalizeGalleryTag(query);
  const suggestions = useMemo(
    () => getGalleryTagVocabulary(index).filter(({ tag }) => !tags.includes(tag) && (!normalized || tag.includes(normalized))),
    [index, tags, normalized],
  );
  const choices = tags.length < MAX_GALLERY_TAGS_PER_ITEM ? [...suggestions.map((entry) => ({ ...entry, create: false }))] : [];
  if (
    tags.length < MAX_GALLERY_TAGS_PER_ITEM &&
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
    if (tags.length >= MAX_GALLERY_TAGS_PER_ITEM || !isValidGalleryTag(tag)) {
      setMessage(text.limit);
      return;
    }
    setTags((current) => [...new Set([...current, tag])]);
    setQuery('');
    setActive(0);
    setMessage('');
    input.current?.focus();
  }
  async function save() {
    if (!target || status !== 'ready') return;
    // An uncommitted draft is included rather than silently discarded by the Save button.
    const draft = normalized ? [...new Set([...tags, normalized])] : tags;
    if (
      (bulk && draft.length === 0) ||
      draft.length > MAX_GALLERY_TAGS_PER_ITEM ||
      draft.some((tag) => !isValidGalleryTag(tag))
    ) {
      setMessage(text.limit);
      return;
    }
    setStatus('saving');
    setMessage('');
    try {
      const response = await fetch('/api/style-gallery/tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` },
        body: JSON.stringify(bulk ? { slugs: target, tags: draft } : { slug, tags: draft, previousTags: base }),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 401) {
        setStatus('login');
        return;
      }
      if (!response.ok) {
        setMessage(response.status === 409 ? text.conflict : response.status === 400 ? await response.text() : text.failed);
        setStatus('ready');
        return;
      }
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
        <DialogDescription>
          {bulk
            ? locale.startsWith('zh')
              ? '为选中的来源图片追加标签，保留已有标签。同源示例一起生效。'
              : locale.startsWith('ja')
                ? '選択した元画像にタグを追加します。既存タグは保持されます。'
                : 'Add tags to the selected sources, keeping their existing categories.'
            : text.description}
        </DialogDescription>
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
              {!choices.length && <p className="p-3 text-muted-foreground text-sm">{tags.length ? text.limit : text.empty}</p>}
            </div>
            {message && (
              <p role="alert" className="text-destructive text-sm">
                {message}
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground text-xs">{tags.length} / 12</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-border px-4 py-2 text-sm"
                  disabled={status === 'saving'}
                  onClick={() => $galleryTagEditor.set(null)}
                >
                  {text.cancel}
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-primary px-4 py-2 text-primary-foreground text-sm"
                  disabled={status === 'saving'}
                  onClick={() => void save()}
                >
                  {status === 'saving' ? text.saving : text.save}
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
