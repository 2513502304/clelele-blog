import { useEffect, useRef, useState } from 'react';
import { useGalleryDialogScrollLock } from '@/hooks/useGalleryDialogScrollLock';
import { profileFrameRatio } from '@/lib/site-profile/image-crop';
import type { SiteAsset, SiteAssetSlot, SiteProfile } from '@/lib/site-profile/schema';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import SiteImageCropper from './SiteImageCropper';

const buttonClass = 'rounded-xl border px-3 py-2 text-sm transition hover:bg-primary/10 disabled:opacity-40';
/** Upload, clipboard and history all feed the same crop editor; selecting history can also reuse its original bytes. */
export default function SiteAssetPicker({
  slot,
  label,
  history,
  protectedKeys,
  busy,
  onClose,
  onUpload,
  onReuse,
  onDelete,
  onDirty,
}: {
  slot: SiteAssetSlot;
  label: string;
  history: SiteProfile['history'];
  protectedKeys: string[];
  busy: boolean;
  onClose: () => void;
  onUpload: (file: File) => Promise<void>;
  onReuse: (key: string) => void;
  onDelete: (key: string) => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const [ratio, setRatio] = useState(1);
  const picker = useRef<HTMLInputElement>(null);
  const dialog = useGalleryDialogScrollLock(true);
  const loadId = useRef(0);
  const disabled = busy || reading || processing;
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const measured = Number(query.get('frame'));
    setRatio(
      slot === 'avatar'
        ? 1
        : query.get('asset') === slot && measured >= 0.2 && measured <= 8
          ? measured
          : profileFrameRatio(slot, window.innerWidth, window.innerHeight),
    );
    return () => {
      loadId.current++;
    };
  }, [slot]);
  useEffect(() => {
    onDirty(Boolean(file));
    return () => onDirty(false);
  }, [file, onDirty]);
  function close() {
    if (!disabled && (!file || window.confirm('放弃当前尚未上传的图片和裁剪？'))) onClose();
  }
  function choose(next: File | undefined) {
    if (!next || disabled) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(next.type) || next.size > 20_000_000) {
      setMessage('请选择 20 MB 以内的 JPEG、PNG、WebP 或 GIF；裁剪结果最大 3 MB。');
      return;
    }
    if (file && !window.confirm('放弃当前裁剪，换用这张图片？')) return;
    setFile(next);
    setMessage('');
  }
  async function editHistory(asset: SiteAsset) {
    if (file && !window.confirm('放弃当前裁剪，重新裁剪这张历史图片？')) return;
    setReading(true);
    setMessage('');
    const id = ++loadId.current;
    try {
      const response = await fetch(`/api/site-profile/source?key=${encodeURIComponent(asset.key)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('历史图片读取失败，请重试。');
      const blob = await response.blob();
      if (loadId.current === id) setFile(new File([blob], asset.name, { type: blob.type }));
    } catch (error) {
      if (loadId.current === id) setMessage(error instanceof Error ? error.message : '读取失败。');
    } finally {
      if (loadId.current === id) setReading(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        ref={dialog}
        animated={false}
        className="flex max-h-[90dvh] max-w-4xl flex-col gap-0 overflow-hidden p-0"
        onPaste={(event) => {
          const image = [...event.clipboardData.files].find((entry) => entry.type.startsWith('image/'));
          if (image) {
            event.preventDefault();
            choose(image);
          }
        }}
      >
        <header className="border-b px-6 py-5">
          <p className="mb-1 text-primary text-xs tracking-widest">IMAGE STUDIO</p>
          <DialogTitle>更换{label}</DialogTitle>
          <DialogDescription className="mt-2">先调整构图，再保存资料。支持文件上传、粘贴与历史复用。</DialogDescription>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
          <fieldset disabled={disabled} className="min-w-0 space-y-5">
            <input
              ref={picker}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(event) => {
                choose(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              className={`${buttonClass} w-full border-dashed py-4`}
              onClick={() => picker.current?.click()}
            >
              {file ? '更换文件 / 粘贴另一张图片' : '选择图片 / Ctrl+V 粘贴'}
            </button>
            {file && (
              <SiteImageCropper
                file={file}
                ratio={ratio}
                avatar={slot === 'avatar'}
                busy={disabled}
                onApply={onUpload}
                onProcessing={setProcessing}
              />
            )}
            {message && (
              <p role="alert" className="text-destructive text-sm">
                {message}
              </p>
            )}
            <div className="flex items-center justify-between border-t pt-5">
              <h3 className="font-semibold">历史图片</h3>
              <span className="text-muted-foreground text-xs">{history.length} 张</span>
            </div>
            <p className="text-muted-foreground text-xs leading-5">
              可直接复用或重新裁剪。在用图片不可删除；删除会同时移除历史记录与 HF 图片文件，无法撤销。
            </p>
            <div className="grid grid-cols-3 gap-3 md:grid-cols-2">
              {[...history].reverse().map((asset) => (
                <article key={asset.key} className="min-w-0 overflow-hidden rounded-xl border bg-muted/20">
                  <img
                    src={`/api/site-assets/${asset.key.split('/')[1]}`}
                    alt={asset.name}
                    className="h-28 w-full object-cover"
                    loading="lazy"
                  />
                  <p className="truncate px-3 pt-2 text-xs" title={asset.name}>
                    {asset.name}
                  </p>
                  <div className="flex flex-wrap gap-1 p-2">
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => {
                        if (!file || window.confirm('放弃当前裁剪，直接复用历史图片？')) onReuse(asset.key);
                      }}
                    >
                      使用
                    </button>
                    <button type="button" className={buttonClass} onClick={() => void editHistory(asset)}>
                      裁剪
                    </button>
                    <button
                      type="button"
                      className={`${buttonClass} text-destructive`}
                      disabled={protectedKeys.includes(asset.key)}
                      aria-label={`删除历史图片 ${asset.name}`}
                      title={protectedKeys.includes(asset.key) ? '已发布或当前草稿正在使用' : '永久删除图片及历史记录'}
                      onClick={async () => {
                        if (!window.confirm(`永久删除“${asset.name}”的历史记录和 HF 图片文件？此操作无法撤销。`)) return;
                        try {
                          await onDelete(asset.key);
                        } catch (error) {
                          setMessage(error instanceof Error ? error.message : '删除失败。');
                        }
                      }}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </fieldset>
        </div>
        <footer className="flex items-center justify-between gap-4 border-t px-6 py-4 text-sm">
          <span className="text-muted-foreground">{reading ? '正在读取历史图片…' : '页面构图预览 · 拖动与缩放'}</span>
          <button type="button" className={buttonClass} disabled={disabled} onClick={close}>
            关闭
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
