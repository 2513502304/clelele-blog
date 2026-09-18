import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@components/ui/dialog';
import { useGalleryDialogScrollLock } from '@hooks/useGalleryDialogScrollLock';
import { getStyleGalleryManagementToken, rememberStyleGalleryManagementToken } from '@lib/style-gallery-management-token';
import type { GalleryMergePreview, GalleryMergeSelection, GalleryMergeSide } from '@lib/style-gallery-merge-types';
import { guardGalleryNavigation } from '@lib/style-gallery-navigation-guard';
import { useEffect, useRef, useState } from 'react';
import GalleryMergeCard from './GalleryMergeCard';

/** Two-card management only: explicit loading keeps list reads cheap; selection never mutates storage.
 * Keep both guards: modal close and page navigation preserve drafts, while save confirms destructive publication.
 * See docs/solutions/ui-bugs/gallery-management-dialogs-and-merges.md before changing modal geometry.
 */
export default function StyleGalleryMerge({
  locale,
  initialHashes,
  onClose,
}: {
  locale: string;
  initialHashes: [string, string];
  onClose: () => void;
}) {
  const zh = locale.startsWith('zh');
  const [open, setOpen] = useState(true);
  const hashes = initialHashes;
  const [token, setToken] = useState(getStyleGalleryManagementToken);
  const [preview, setPreview] = useState<GalleryMergePreview | null>(null);
  const [choice, setChoice] = useState<GalleryMergeSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const release = useRef<(() => void) | undefined>(undefined);
  const dialogRef = useGalleryDialogScrollLock(open);
  const dirty = hashes.some(Boolean) || Boolean(preview);
  const discard = zh ? '放弃当前合并选择并退出？尚未提交的改动将丢失。' : 'Discard this merge selection and leave?';
  useEffect(() => {
    if (!open || (!dirty && !busy)) return;
    release.current = guardGalleryNavigation(
      busy ? (zh ? '正在保存合并，请勿离开。' : 'Saving the merge. Do not leave.') : discard,
    );
    return () => {
      release.current?.();
      release.current = undefined;
    };
  }, [open, dirty, busy, discard, zh]);
  function changeOpen(next: boolean) {
    if (busy || (!next && dirty && !window.confirm(discard))) return;
    setOpen(next);
    if (!next) onClose();
  }
  async function request(body: unknown) {
    const response = await fetch('/api/style-gallery/merge', {
      method: 'POST',
      headers: { authorization: `Bearer ${token.trim()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      if (response.status === 409) throw new Error(zh ? '数据已发生变化，请重新加载两张卡片后再合并。' : detail);
      if (response.status === 401) throw new Error(zh ? '管理 token 不正确。' : detail);
      throw new Error(detail);
    }
    rememberStyleGalleryManagementToken(token.trim());
    return response.json();
  }
  async function load() {
    if (preview && !window.confirm(zh ? '重新加载将重置当前合并选择，是否继续？' : 'Reload and reset this selection?')) return;
    setBusy(true);
    setError('');
    try {
      const data: GalleryMergePreview = await request({ action: 'preview', hashes: hashes.map((hash) => hash.trim()) });
      setPreview(data);
      const originals = data.cards.flatMap((card, side) =>
        card.item.prompts
          .filter((prompt) => prompt.originalPrompt)
          .map((prompt) => ({ side: side as GalleryMergeSide, id: prompt.id })),
      );
      setChoice({
        keep: 0,
        date: 0,
        prompts: data.cards.flatMap((card, side) =>
          card.item.prompts.map((prompt) => ({ side: side as GalleryMergeSide, id: prompt.id })),
        ),
        original: originals[0] ?? null,
        examples: [0, 1],
        tags: [...new Set(data.cards.flatMap((card) => card.tags))],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  const autoLoad = useRef(false);
  // The dialog is keyed by the selected pair; later token/choice edits must not reload it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: One initial request per selected pair.
  useEffect(() => {
    if (autoLoad.current) return;
    autoLoad.current = true;
    if (getStyleGalleryManagementToken()) void load();
  }, []);
  async function save() {
    if (!preview || !choice) return;
    const kept = preview.cards[choice.keep].item;
    const removed = preview.cards[choice.keep === 0 ? 1 : 0].item;
    const count = new Set(choice.prompts.map((prompt) => prompt.id)).size;
    const examples = new Set(
      choice.examples.flatMap((side) =>
        preview.cards[side].item.examples.map((image) => `${image.model.toLowerCase()}::${image.imageHash}`),
      ),
    ).size;
    const message = zh
      ? `确认合并？\n保留：${kept.imageHash.slice(0, 12)}\n移除：${removed.imageHash.slice(0, 12)}\n最终保留 ${count} 个 Prompt、${examples} 张子图、${choice.tags.length} 个标签。\n未选择的信息不会保留在最终卡片中；旧链接将跳转。此操作没有一键撤销。`
      : `Merge these cards?\nKeep ${kept.imageHash.slice(0, 12)}; remove ${removed.imageHash.slice(0, 12)}.\nKeep ${count} prompts, ${examples} sub-images and ${choice.tags.length} tags. Unselected information is removed from the final card. There is no one-click undo.`;
    if (!window.confirm(message)) return;
    setBusy(true);
    setError('');
    try {
      const result = await request({
        action: 'merge',
        hashes: preview.cards.map((card) => card.item.imageHash),
        revisions: preview.cards.map((card) => card.revision),
        selection: choice,
      });
      release.current?.();
      release.current = undefined;
      window.location.assign(`${locale.startsWith('zh') ? '' : `/${locale}`}/image-style-prompt-gallery/${result.slug}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        ref={dialogRef}
        stableScroll
        showClose={!busy}
        className="flex h-[90dvh] max-h-[64rem] w-[calc(100%-2rem)] max-w-6xl flex-col gap-0 overflow-hidden rounded-2xl p-0"
      >
        <header className="shrink-0 border-border border-b p-5 pr-12">
          <DialogTitle>{zh ? '合并两张卡片' : 'Merge two cards'}</DialogTitle>
          <DialogDescription>
            {zh
              ? '主图与身份、日期和用户原始 Prompt 单选；模型 Prompt、子图分组和标签可多选。点赞随保留的子图自动合并。'
              : 'Choose one identity, date and original prompt; keep multiple generated prompts, sub-image groups and tags. Likes follow retained sub-images.'}
          </DialogDescription>
        </header>
        {/* Keep scrolling outside fieldset; header/footer stay fixed while each long prompt scrolls independently. */}
        <div className="vertical-scrollbar min-h-0 flex-1 overflow-y-scroll overscroll-contain p-5" data-merge-scroll>
          <fieldset disabled={busy} className="min-w-0 space-y-5">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void load();
              }}
              className="grid grid-cols-2 gap-3 max-[640px]:grid-cols-1"
            >
              <div className="col-span-full rounded-lg bg-muted p-3 text-sm">
                {zh ? '已选两张卡片：' : 'Selected pair: '}
                {hashes.map((hash) => hash.slice(0, 12)).join(' · ')}
              </div>
              <label className="text-sm">
                {zh ? '管理 token' : 'Management token'}
                <input
                  type="password"
                  autoComplete="off"
                  required
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3"
                />
              </label>
              <button type="submit" className="self-end rounded-lg border border-border px-4 py-3 text-sm hover:border-primary">
                {busy ? (zh ? '处理中…' : 'Working…') : zh ? '加载对比' : 'Load comparison'}
              </button>
            </form>
            {preview && choice && (
              <>
                <div className="grid grid-cols-2 items-start gap-4 max-[640px]:grid-cols-1">
                  {preview.cards.map((card, side) => (
                    <GalleryMergeCard
                      key={card.item.slug}
                      card={card}
                      side={side as GalleryMergeSide}
                      choice={choice}
                      onChange={setChoice}
                      locale={locale}
                    />
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="merge-original"
                    checked={choice.original === null}
                    onChange={() => setChoice({ ...choice, original: null })}
                  />
                  {zh ? '不保留用户原始 Prompt' : 'Do not keep an original prompt'}
                </label>
                <p className="text-muted-foreground text-xs">
                  {zh
                    ? '按勾选顺序保留 Prompt，第一项为默认；重复文本会去重。相同平台、相同图像的子图去重，同一子图的同一用户点赞只计一次。标签最多 12 个。'
                    : 'The first selected prompt is the default. Duplicate prompts and same-platform images are deduplicated. Each user has one vote per image. Keep up to 12 tags.'}
                </p>
              </>
            )}
          </fieldset>
        </div>
        <footer className="shrink-0 space-y-2 border-border border-t bg-background p-4">
          {error && (
            <p role="alert" className="text-rose-500 text-sm">
              {error}
            </p>
          )}
          {choice && choice.tags.length > 12 && (
            <p role="alert" className="text-rose-500 text-sm">
              {zh ? '请将保留标签减少至 12 个以内。' : 'Keep at most 12 tags.'}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" disabled={busy} onClick={() => changeOpen(false)} className="rounded-lg px-4 py-2 text-sm">
              {zh ? '取消' : 'Cancel'}
            </button>
            <button
              type="button"
              disabled={
                busy ||
                !choice?.prompts.length ||
                choice.tags.length > 12 ||
                Boolean(
                  preview &&
                    hashes.some(
                      (hash, side) => !preview.cards[side].item.imageHash.startsWith(hash.toLowerCase()) || hash.length < 12,
                    ),
                )
              }
              onClick={() => void save()}
              className="rounded-lg bg-primary px-5 py-2 font-semibold text-primary-foreground text-sm disabled:opacity-50"
            >
              {busy ? (zh ? '处理中…' : 'Working…') : zh ? '确认合并…' : 'Confirm merge…'}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
