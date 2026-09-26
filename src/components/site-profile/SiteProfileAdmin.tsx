import { useEffect, useRef, useState } from 'react';
import { useGalleryDialogScrollLock } from '@/hooks/useGalleryDialogScrollLock';
import { SITE_ASSET_SLOTS, type SiteAssetSlot, type SiteProfile, siteAssetUrl } from '@/lib/site-profile/schema';
import { guardGalleryNavigation } from '@/lib/style-gallery-navigation-guard';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';

const labels: Record<SiteAssetSlot, string> = {
  avatar: '头像',
  home: '首页',
  weekly: '周刊',
  about: '关于',
  music: '歌单',
  bangumi: '追番',
  hpoi: '手办收藏',
  links: '友链',
  gallery: '风格提示词',
  posts: '文章',
  categories: '分类',
  tags: '标签',
};
const inputClass = 'w-full rounded-xl border bg-background px-3 py-2 text-base leading-6 outline-none focus:border-primary';
const buttonClass = 'rounded-xl border px-4 py-2 text-sm transition hover:bg-primary/10 disabled:opacity-50';
function assetUrl(key: string) {
  return `/api/site-assets/${key.split('/')[1]}`;
}
/** Profile fields stay local until explicit confirmation; uploaded blobs only enter history until Save. */
export default function SiteProfileAdmin({ initial }: { initial: SiteProfile }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [slot, setSlot] = useState<SiteAssetSlot | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const dirty =
    JSON.stringify({ name: draft.name, signature: draft.signature, links: draft.links, assets: draft.assets }) !==
    JSON.stringify({ name: saved.name, signature: saved.signature, links: saved.links, assets: saved.assets });
  const dialogRef = useGalleryDialogScrollLock(Boolean(slot));
  useEffect(() => {
    const value = new URLSearchParams(location.search).get('asset');
    if (SITE_ASSET_SLOTS.includes(value as SiteAssetSlot)) setSlot(value as SiteAssetSlot);
  }, []);
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
    if (dirty || file) return guardGalleryNavigation('放弃尚未保存的资料修改？');
  }, [dirty, file]);
  async function request(body: BodyInit, headers?: HeadersInit) {
    const response = await fetch('/api/site-profile/admin', { method: 'POST', body, headers });
    if (!response.ok) throw new Error(await response.text());
    return response;
  }
  function choose(next: File | undefined) {
    if (!next) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(next.type) || next.size > 3_000_000) {
      setMessage('请选择 3 MB 以内的 JPEG、PNG、WebP 或 GIF 图片。');
      return;
    }
    setFile(next);
    setMessage('');
  }
  async function upload() {
    if (!file || !slot || busy) return;
    if (!window.confirm('上传这张图片到历史记录，并设为待保存的图片？')) return;
    const selectedSlot = slot;
    setBusy(true);
    try {
      const body = new FormData();
      body.set('file', file);
      body.set('revision', saved.revision);
      const result = (await (await request(body)).json()) as { profile: SiteProfile; asset: SiteProfile['history'][number] };
      setSaved(result.profile);
      setDraft((current) => ({
        ...current,
        revision: result.profile.revision,
        history: result.profile.history,
        assets: { ...current.assets, [selectedSlot]: result.asset.key },
      }));
      setFile(null);
      setSlot(null);
      setMessage('图片已加入历史。请保存资料以发布更换。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '上传失败。');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!dirty || busy || !window.confirm('确认发布这些资料和图片修改？所有访客都将看到更新。')) return;
    setBusy(true);
    try {
      const result = (await (
        await request(
          JSON.stringify({
            revision: saved.revision,
            profile: { name: draft.name, signature: draft.signature, links: draft.links },
            assets: draft.assets,
          }),
          { 'content-type': 'application/json' },
        )
      ).json()) as SiteProfile;
      setSaved(result);
      setDraft(result);
      setMessage('已保存。公开页面缓存将在约 30–60 秒内刷新。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-5 pt-24 pb-10">
      <header>
        <p className="text-primary text-sm">站点管理</p>
        <h1 className="mt-2 font-bold text-3xl">个人资料与页面图片</h1>
        <p className="mt-3 text-muted-foreground">侧栏与“找到我”同步更新；关于页的正文仍在仓库中编辑。</p>
      </header>
      {message && <output className="block rounded-xl border p-4">{message}</output>}
      <fieldset disabled={busy} className="space-y-8">
        <section className="grid gap-5 rounded-2xl border bg-card p-6">
          <label>
            显示名称
            <input
              className={inputClass}
              value={draft.name}
              maxLength={80}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            个人签名
            <textarea
              className={`${inputClass} h-24 resize-none overflow-y-auto overscroll-contain`}
              value={draft.signature}
              maxLength={500}
              onChange={(e) => setDraft({ ...draft, signature: e.target.value })}
            />
          </label>
        </section>
        <section className="rounded-2xl border bg-card p-6">
          <h2 className="mb-4 font-semibold text-xl">联系方式</h2>
          <div className="space-y-4">
            {draft.links.map((link, index) => (
              <div key={link.id} className="grid grid-cols-2 gap-3 rounded-xl border p-4 md:grid-cols-1">
                {(['label', 'text', 'url', 'icon', 'color'] as const).map((field) => (
                  <label key={field} className={field === 'url' ? 'col-span-full' : ''}>
                    <span className="text-muted-foreground text-sm">
                      {
                        {
                          label: '平台名称',
                          text: '链接显示文字',
                          url: '链接（https / mailto / 站内路径）',
                          icon: '图标（例如 ri:github-fill）',
                          color: '图标颜色',
                        }[field]
                      }
                    </span>
                    <input
                      className={inputClass}
                      value={link[field]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          links: draft.links.map((row, i) => (i === index ? { ...row, [field]: e.target.value } : row)),
                        })
                      }
                    />
                  </label>
                ))}
                <div className="col-span-full flex gap-2">
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={index === 0}
                    onClick={() => {
                      const links = [...draft.links];
                      [links[index - 1], links[index]] = [links[index], links[index - 1]];
                      setDraft({ ...draft, links });
                    }}
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => {
                      if (window.confirm(`移除“${link.label}”？保存后才会生效。`))
                        setDraft({ ...draft, links: draft.links.filter((_, i) => i !== index) });
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className={`${buttonClass} mt-4`}
            disabled={draft.links.length >= 50}
            onClick={() =>
              setDraft({
                ...draft,
                links: [
                  ...draft.links,
                  { id: crypto.randomUUID(), label: '', text: '', url: '', icon: 'ri:link', color: '#ff477e' },
                ],
              })
            }
          >
            添加联系方式
          </button>
        </section>
        <section>
          <h2 className="mb-4 font-semibold text-xl">头像与页面横幅</h2>
          <p className="mb-4 text-muted-foreground">未单独设置的页面沿用首页横幅。点击图片可以上传、粘贴或选用历史图片。</p>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-1">
            {SITE_ASSET_SLOTS.map((value) => (
              <div key={value} className="overflow-hidden rounded-2xl border bg-card">
                <button
                  type="button"
                  aria-label={`更换${labels[value]}`}
                  className="w-full text-left"
                  onClick={() => setSlot(value)}
                >
                  <img
                    src={draft.assets[value] ? assetUrl(draft.assets[value] ?? '') : siteAssetUrl('home', saved.revision)}
                    alt={labels[value]}
                    className={`h-40 w-full ${value === 'avatar' ? 'object-contain' : 'object-cover'}`}
                  />
                  <span className="block p-4">
                    {labels[value]}
                    {!draft.assets[value] ? ' · 沿用首页' : ''}
                  </span>
                </button>
                {!['avatar', 'home'].includes(value) && draft.assets[value] && (
                  <button
                    type="button"
                    className={`${buttonClass} m-4 mt-0`}
                    onClick={() => {
                      const assets = { ...draft.assets };
                      delete assets[value];
                      setDraft({ ...draft, assets });
                    }}
                  >
                    恢复首页横幅
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </fieldset>
      <footer className="sticky bottom-4 flex items-center justify-between rounded-2xl border bg-background/95 p-4 shadow-xl backdrop-blur">
        <span className="text-sm">{dirty ? '有尚未发布的修改' : '资料已同步'}</span>
        <button
          type="button"
          className={`${buttonClass} bg-primary text-white`}
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {busy ? '处理中…' : '保存并发布'}
        </button>
      </footer>
      <Dialog
        open={Boolean(slot)}
        onOpenChange={(open) => {
          if (!open && !busy && (!file || window.confirm('放弃当前尚未上传的图片？'))) {
            setSlot(null);
            setFile(null);
          }
        }}
      >
        <DialogContent
          ref={dialogRef}
          animated={false}
          className="flex max-h-[85dvh] max-w-4xl flex-col gap-0 overflow-hidden p-0"
          onPaste={(event) => {
            const image = [...event.clipboardData.files].find((entry) => entry.type.startsWith('image/'));
            if (image) {
              event.preventDefault();
              choose(image);
            }
          }}
        >
          <div className="border-b p-5">
            <DialogTitle>更换{slot ? labels[slot] : ''}</DialogTitle>
            <DialogDescription>选择文件，或在窗口中粘贴图片。历史图片可直接复用。</DialogDescription>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-5">
            <input
              ref={picker}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                choose(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={busy}
              className="w-full rounded-xl border-2 border-dashed p-6 text-center"
              onClick={() => picker.current?.click()}
            >
              {preview ? (
                <img src={preview} alt="待上传图片" className="mx-auto max-h-72 object-contain" />
              ) : (
                '点击上传图片 / Ctrl+V 粘贴（最大 3 MB）'
              )}
            </button>
            {message && <output className="block rounded-xl border p-3 text-sm">{message}</output>}
            <h3>历史图片</h3>
            <div className="grid grid-cols-3 gap-3 md:grid-cols-2">
              {[...draft.history].reverse().map((asset) => (
                <button
                  type="button"
                  disabled={busy}
                  className="overflow-hidden rounded-xl border hover:border-primary"
                  key={asset.key}
                  onClick={() => {
                    if (!slot) return;
                    if (file && !window.confirm('放弃当前文件，改用历史图片？')) return;
                    setDraft({ ...draft, assets: { ...draft.assets, [slot]: asset.key } });
                    setFile(null);
                    setSlot(null);
                  }}
                >
                  <img src={assetUrl(asset.key)} alt={asset.name} className="h-32 w-full object-cover" loading="lazy" />
                  <span className="block truncate p-2 text-xs">{asset.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t p-4">
            <button type="button" className={buttonClass} disabled={!file || busy} onClick={() => void upload()}>
              {busy ? '上传中…' : '使用这张图片'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
