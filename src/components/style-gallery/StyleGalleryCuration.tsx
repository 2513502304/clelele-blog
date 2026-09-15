import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@components/ui/dialog';
import { Icon } from '@iconify/react';
import { MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE } from '@lib/style-gallery-chunk-upload';
import { getStyleGalleryExampleExtension } from '@lib/style-gallery-image-type';
import { getStyleGalleryManagementToken, rememberStyleGalleryManagementToken } from '@lib/style-gallery-management-token';
import { guardGalleryNavigation } from '@lib/style-gallery-navigation-guard';
import { useEffect, useId, useRef, useState } from 'react';
import type { StyleGalleryPromptVariant } from '@/types/style-gallery';

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
        format: 'JPG / PNG / WebP，最大 12 MB',
        indexFailed: '图片已收藏，视觉索引未完成。再次保存即可重试。',
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
        format: 'JPG / PNG / WebP, up to 12 MB',
        indexFailed: 'Image saved; visual index incomplete. Save again to retry.',
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
  const [model, setModel] = useState('');
  const [token, setToken] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const releaseGuard = useRef<(() => void) | undefined>(undefined);
  const editing = Boolean(variant && slug);
  const dirty = editing ? prompt !== variant?.prompt : Boolean(prompt || original || model || file);
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!open || (!dirty && !busy)) return;
    releaseGuard.current = guardGalleryNavigation(text.discard);
    return () => {
      releaseGuard.current?.();
      releaseGuard.current = undefined;
    };
  }, [open, dirty, busy, text.discard]);
  function changeOpen(next: boolean) {
    if (busy || (!next && dirty && !window.confirm(text.discard))) return;
    if (next) {
      setPrompt(variant?.prompt ?? '');
      setOriginal('');
      setModel('');
      setFile(null);
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
          body: JSON.stringify({ id: variant.id, prompt }),
          signal: AbortSignal.timeout(120_000),
        });
      } else {
        if (!file || !file.size || file.size > MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE) throw new Error(text.format);
        const extension = getStyleGalleryExampleExtension(file.type, file.name);
        setStatus(text.prepare);
        if (import.meta.env.SSR) throw new Error('Image processing requires a browser.');
        const { sha256, uploadFile } = await import('@lib/style-gallery-upload-client');
        const imageHash = await sha256(file);
        await uploadFile(
          '/api/style-gallery/source-upload?source=1',
          file,
          imageHash,
          extension,
          token.trim(),
          (loaded, total) => setStatus(`${text.upload} ${Math.round((loaded / total) * 100)}%`),
          () => setStatus(text.saving),
        );
        setStatus(text.prepare);
        const { computeStyleGalleryVisualFeatureFromFile } = await import('@lib/style-gallery-visual-feature-browser');
        const feature = await computeStyleGalleryVisualFeatureFromFile(file, imageHash);
        setStatus(text.saving);
        response = await fetch('/api/style-gallery/manual', {
          method: 'POST',
          headers: { authorization: `Bearer ${token.trim()}`, 'content-type': 'application/json' },
          body: JSON.stringify({ imageHash, extension, feature, prompt, originalPrompt: original, model }),
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
      } else if (result.visualIndexUpdated === false) {
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
            : 'flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm transition hover:border-primary/40 hover:text-primary'
        }
      >
        <Icon icon={editing ? 'ri:edit-line' : 'ri:image-add-line'} className="size-4" />
        {!editing && text.collect}
      </button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent
          stableScroll
          className="flex max-h-[90dvh] max-w-2xl flex-col overflow-hidden rounded-2xl p-0"
          showClose={!busy}
        >
          <header className="border-border border-b p-5 pr-12">
            <DialogTitle>{editing ? text.edit : text.collect}</DialogTitle>
            <DialogDescription className="mt-2">{editing ? text.editDescription : text.description}</DialogDescription>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            className="flex min-h-0 flex-col"
          >
            <fieldset disabled={busy} className="min-h-0 space-y-4 overflow-y-auto p-5">
              {!editing && (
                <>
                  <label className="block space-y-2 text-sm" htmlFor={`${id}-file`}>
                    <span>{text.image}</span>
                    <input
                      id={`${id}-file`}
                      type="file"
                      aria-label={text.image}
                      accept="image/jpeg,image/png,image/webp"
                      required
                      className={fieldClass}
                      onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    />
                    <span className="block text-muted-foreground text-xs">{text.format}</span>
                  </label>
                  {preview && (
                    <img src={preview} alt={text.image} className="mx-auto max-h-44 max-w-full rounded-lg object-contain" />
                  )}
                  <label className="block space-y-2 text-sm" htmlFor={`${id}-original`}>
                    <span>{text.original}</span>
                    <textarea
                      id={`${id}-original`}
                      value={original}
                      onChange={(event) => setOriginal(event.target.value)}
                      maxLength={20000}
                      rows={2}
                      style={{ minHeight: 72 }}
                      className={fieldClass}
                    />
                  </label>
                </>
              )}
              <label className="block space-y-2 text-sm" htmlFor={`${id}-prompt`}>
                <span>{text.prompt}</span>
                <textarea
                  id={`${id}-prompt`}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  required
                  maxLength={100000}
                  rows={editing ? 12 : 6}
                  style={{ minHeight: editing ? 240 : 144 }}
                  className={`${fieldClass} leading-6`}
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
                    className={fieldClass}
                    placeholder="GPT-Image / Gemini / …"
                  />
                </label>
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
            <footer className="space-y-3 border-border border-t p-4">
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
                  disabled={busy || !prompt.trim() || !token.trim() || (!editing && !file)}
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
