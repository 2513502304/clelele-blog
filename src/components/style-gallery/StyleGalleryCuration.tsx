import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@components/ui/dialog';
import { useGalleryDialogScrollLock } from '@hooks/useGalleryDialogScrollLock';
import { Icon } from '@iconify/react';
import { MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE } from '@lib/style-gallery-chunk-upload';
import { getStyleGalleryExampleExtension } from '@lib/style-gallery-image-type';
import { getStyleGalleryManagementToken, rememberStyleGalleryManagementToken } from '@lib/style-gallery-management-token';
import { guardGalleryNavigation } from '@lib/style-gallery-navigation-guard';
import { isValidGalleryTag, MAX_GALLERY_TAGS_PER_ITEM, normalizeGalleryTag } from '@lib/style-gallery-tags';
import { useEffect, useId, useRef, useState } from 'react';
import type { StyleGalleryPromptVariant } from '@/types/style-gallery';
import GalleryCollectionPreview from './GalleryCollectionPreview';
import GalleryCollectionTags from './GalleryCollectionTags';

function labels(locale: string) {
  return locale.startsWith('zh')
    ? {
        collect: '收藏图片',
        edit: '编辑 Prompt',
        description: '选择参考图片，填入想收藏的提示词。收藏日期自动记录。',
        editDescription: '修改当前候选的提示词，其他候选保持不变。',
        image: '参考图片',
        prompt: '模型反推 Prompt',
        original: '用户原始 Prompt（选填）',
        model: '模型名称（选填）',
        token: '管理 token',
        save: '保存',
        cancel: '取消',
        prepare: '正在准备图片与视觉特征…',
        upload: '正在上传',
        saving: '正在保存…',
        failed: '保存失败，请重试。',
        conflict: '该提示词已被修改或与另一候选重复。请保留草稿，刷新后核对。',
        discard: '放弃尚未保存的修改？',
        format: 'JPG / PNG / WebP，每张最大 12 MB，最多 20 张',
        indexFailed: '图片已收藏，标签或视觉索引未完成。再次保存即可重试。',
      }
    : {
        collect: 'Collect image',
        edit: 'Edit prompt',
        description: 'Choose a reference image and save its reusable prompt. The collection date is recorded automatically.',
        editDescription: 'Edit the selected prompt without changing other variants.',
        image: 'Reference image',
        prompt: 'Generated prompt',
        original: 'Original prompt (optional)',
        model: 'Model (optional)',
        token: 'Management token',
        save: 'Save',
        cancel: 'Cancel',
        prepare: 'Preparing image and visual features…',
        upload: 'Uploading',
        saving: 'Saving…',
        failed: 'Unable to save. Please retry.',
        conflict: 'This prompt changed or duplicates another variant. Keep your draft and reload to compare.',
        discard: 'Discard unsaved changes?',
        format: 'JPG / PNG / WebP, up to 12 MB each, 20 images maximum',
        indexFailed: 'Image saved; tags or visual index incomplete. Save again to retry.',
      };
}
const fieldClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15';

/** Opening the editor performs no reads. Expensive image processing is imported only after a manual upload is submitted. */
export default function StyleGalleryCuration({
  locale,
  slug,
  variant,
  onSaved,
}: {
  locale: string;
  slug?: string;
  variant?: StyleGalleryPromptVariant;
  onSaved?: (prompts: StyleGalleryPromptVariant[], activeId: string) => void;
}) {
  const text = labels(locale);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [original, setOriginal] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagQuery, setTagQuery] = useState('');
  const [model, setModel] = useState('');
  const [token, setToken] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const releaseGuard = useRef<(() => void) | undefined>(undefined);
  const editing = Boolean(variant && slug);
  const dirty = editing
    ? prompt !== variant?.prompt || original !== (variant?.originalPrompt ?? '')
    : Boolean(prompt || original || model || files.length || tags.length || tagQuery);
  const dialogRef = useGalleryDialogScrollLock(open);
  useEffect(() => {
    if (!open || (!dirty && !busy)) return;
    releaseGuard.current = guardGalleryNavigation(text.discard);
    return () => {
      releaseGuard.current?.();
      releaseGuard.current = undefined;
    };
  }, [open, dirty, busy, text.discard]);
  // File-picker selections append; clearing the native input lets a removed file be chosen again.
  function appendFiles(incoming: File[]) {
    if (busy || editing || !incoming.length) return;
    try {
      if (
        files.length + incoming.length > 20 ||
        incoming.some(
          (file) =>
            !getStyleGalleryExampleExtension(file.type, file.name) ||
            !file.size ||
            file.size > MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE,
        )
      ) {
        setError(text.format);
        return;
      }
      setFiles((current) => [...current, ...incoming]);
      setError('');
    } catch {
      setError(text.format);
    }
  }
  function changeOpen(next: boolean) {
    if (busy || (!next && dirty && !window.confirm(text.discard))) return;
    if (next) {
      setPrompt(variant?.prompt ?? '');
      setOriginal(variant?.originalPrompt ?? '');
      setTags([]);
      setTagQuery('');
      setModel('');
      setFiles([]);
      setToken(getStyleGalleryManagementToken());
      setError('');
      setStatus('');
    }
    setOpen(next);
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    setStatus(text.saving);
    try {
      let response: Response;
      if (editing && variant) {
        response = await fetch(`/api/style-gallery/prompts/${slug}`, {
          method: 'PATCH',
          headers: { authorization: `Bearer ${token.trim()}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            id: variant.id,
            prompt,
            originalPrompt: original,
            previousOriginalPrompt: variant.originalPrompt ?? '',
          }),
          signal: AbortSignal.timeout(120_000),
        });
      } else {
        const draftTags = [...new Set([...tags, normalizeGalleryTag(tagQuery)].filter(Boolean))];
        if (draftTags.length > MAX_GALLERY_TAGS_PER_ITEM || draftTags.some((tag) => !isValidGalleryTag(tag)))
          throw new Error(
            locale.startsWith('zh')
              ? '标签最多 12 个，每个 1–24 字；不能含 #、尖括号或控制字符，null 为保留词。'
              : 'Choose up to 12 valid tags.',
          );
        if (
          !files.length ||
          files.length > 20 ||
          files.some((file) => !file.size || file.size > MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE)
        )
          throw new Error(text.format);
        // Validate every file before the first network write; compute/upload sequentially to bound browser memory.
        const extensions = files.map((file) => getStyleGalleryExampleExtension(file.type, file.name));
        setStatus(text.prepare);
        if (import.meta.env.SSR) throw new Error('Image processing requires a browser.');
        const { sha256, uploadFile } = await import('@lib/style-gallery-upload-client');
        const { computeStyleGalleryVisualFeatureFromFile } = await import('@lib/style-gallery-visual-feature-browser');
        const images = [];
        const seen = new Set<string>();
        for (const [i, file] of files.entries()) {
          const imageHash = await sha256(file);
          if (seen.has(imageHash)) continue;
          seen.add(imageHash);
          const extension = extensions[i];
          await uploadFile(
            '/api/style-gallery/source-upload?source=1',
            file,
            imageHash,
            extension,
            token.trim(),
            (loaded, total) => setStatus(`${text.upload} ${i + 1}/${files.length} · ${Math.round((loaded / total) * 100)}%`),
            () => setStatus(text.saving),
          );
          setStatus(`${text.prepare} ${i + 1}/${files.length}`);
          const feature = await computeStyleGalleryVisualFeatureFromFile(file, imageHash);
          images.push({ imageHash, extension, feature });
        }
        setStatus(text.saving);
        response = await fetch('/api/style-gallery/manual', {
          method: 'POST',
          headers: { authorization: `Bearer ${token.trim()}`, 'content-type': 'application/json' },
          body: JSON.stringify({ images, prompt, originalPrompt: original, model, tags: draftTags }),
          signal: AbortSignal.timeout(120_000),
        });
      }
      if (!response.ok)
        throw new Error(
          response.status === 409 ? text.conflict : response.status === 401 ? `${text.token}: ${text.failed}` : text.failed,
        );
      const result = await response.json();
      rememberStyleGalleryManagementToken(token);
      if (editing) {
        onSaved?.(result.prompts, result.activePromptId);
        setOpen(false);
      } else if (result.visualIndexUpdated === false || result.tagsUpdated === false) {
        setError(text.indexFailed);
      } else {
        releaseGuard.current?.();
        releaseGuard.current = undefined;
        setOpen(false);
        const prefix = locale.startsWith('zh') ? '' : `/${locale}`;
        window.location.assign(`${prefix}/image-style-prompt-gallery/${result.slug}`);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : text.failed);
    } finally {
      setBusy(false);
      setStatus('');
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => changeOpen(true)}
        title={editing ? text.edit : text.collect}
        aria-label={editing ? text.edit : text.collect}
        className={
          editing
            ? 'flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition hover:text-primary'
            : 'flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm transition hover:border-primary/40 hover:text-primary'
        }
      >
        <Icon icon={editing ? 'ri:edit-line' : 'ri:image-add-line'} className="size-4" />
        {!editing && text.collect}
      </button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent
          animated={false}
          stableScroll
          ref={dialogRef}
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
            if (!editing && pasted.length) {
              event.preventDefault();
              appendFiles(pasted);
            }
          }}
          className="flex h-[90dvh] max-h-[52rem] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl p-0"
          showClose={!busy}
        >
          <header className="shrink-0 border-border border-b p-5 pr-12">
            <DialogTitle>{editing ? text.edit : text.collect}</DialogTitle>
            <DialogDescription className="mt-2">{editing ? text.editDescription : text.description}</DialogDescription>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {/* Fieldsets resist flex shrinking: this wrapper owns scrolling so files and tag suggestions stay reachable. */}
            <div
              data-curation-scroll
              className="vertical-scrollbar min-h-0 flex-1 overflow-y-scroll overscroll-contain p-5"
              style={{ scrollbarGutter: 'stable' }}
            >
              <fieldset disabled={busy} className="min-w-0 space-y-4">
                {!editing && (
                  <>
                    <label className="block space-y-2 text-sm" htmlFor={`${id}-file`}>
                      <span>{text.image}</span>
                      <input
                        id={`${id}-file`}
                        type="file"
                        aria-label={text.image}
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        className={fieldClass}
                        onChange={(event) => {
                          appendFiles(Array.from(event.target.files ?? []));
                          event.target.value = '';
                        }}
                      />
                      <span className="block text-muted-foreground text-xs">{text.format}</span>
                    </label>
                    <p className="text-muted-foreground text-xs">
                      {locale.startsWith('zh')
                        ? '可重复选择文件或直接粘贴图片；点击卡片预览，在大图工具栏移除单张。'
                        : 'Add files repeatedly or paste images. Preview the stack to remove individual images from its toolbar.'}
                    </p>
                    <GalleryCollectionPreview
                      files={files}
                      locale={locale}
                      onRemove={(file) => setFiles((current) => current.filter((selected) => selected !== file))}
                    />
                  </>
                )}
                <label className="block space-y-2 text-sm" htmlFor={`${id}-original`}>
                  <span>{text.original}</span>
                  <textarea
                    id={`${id}-original`}
                    value={original}
                    onChange={(event) => setOriginal(event.target.value)}
                    maxLength={20000}
                    rows={2}
                    style={{ fieldSizing: 'fixed', height: 96, overflowY: 'auto', resize: 'none' }}
                    className={`${fieldClass} vertical-scrollbar`}
                  />
                </label>
                <label className="block space-y-2 text-sm" htmlFor={`${id}-prompt`}>
                  <span>{text.prompt}</span>
                  <textarea
                    id={`${id}-prompt`}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    required
                    maxLength={100000}
                    rows={editing ? 12 : 6}
                    style={{ fieldSizing: 'fixed', height: editing ? 240 : 168, overflowY: 'auto', resize: 'none' }}
                    className={`${fieldClass} vertical-scrollbar leading-6`}
                  />
                </label>
                {!editing && (
                  <label className="block space-y-2 text-sm" htmlFor={`${id}-model`}>
                    <span>{text.model}</span>
                    <input
                      id={`${id}-model`}
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                      maxLength={120}
                      className={`${fieldClass} h-11 leading-6 placeholder:text-xs`}
                      placeholder="GPT-Image / Gemini / …"
                    />
                  </label>
                )}
                {!editing && (
                  <GalleryCollectionTags
                    locale={locale}
                    tags={tags}
                    onChange={setTags}
                    query={tagQuery}
                    onQueryChange={setTagQuery}
                  />
                )}
                <label className="block space-y-2 text-sm" htmlFor={`${id}-token`}>
                  <span>{text.token}</span>
                  <input
                    id={`${id}-token`}
                    type="password"
                    autoComplete="off"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    required
                    className={fieldClass}
                  />
                </label>
              </fieldset>
            </div>
            <footer className="shrink-0 space-y-3 border-border border-t bg-background p-4">
              {error && (
                <p role="alert" className="text-rose-500 text-sm">
                  {error}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <output className="mr-auto text-muted-foreground text-xs">{status}</output>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => changeOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
                >
                  {text.cancel}
                </button>
                <button
                  type="submit"
                  disabled={busy || !prompt.trim() || !token.trim() || (!editing && !files.length)}
                  className="rounded-lg bg-primary px-5 py-2 font-semibold text-primary-foreground text-sm disabled:opacity-50"
                >
                  {busy ? text.saving : text.save}
                </button>
              </div>
            </footer>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
