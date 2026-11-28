import { useEffect, useRef, useState } from 'react';
import type { HpoiPurchase } from '@/lib/hpoi/purchases-schema';

interface PurchaseView {
  configured: boolean;
  canRefresh: boolean;
  snapshot: { fetchedAt: string; records: HpoiPurchase[] } | null;
  job: { id: string; done: number; total: number; phase: 'discovery' | 'details'; error: boolean; busy: boolean } | null;
}

const endpoint = '/api/hpoi/purchases';

/** Mounted only after the owner explicitly opens this panel; no private data enters browser storage. */
export default function HpoiPurchasesAdmin() {
  const [view, setView] = useState<PurchaseView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(false);

  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    fetch(endpoint, { cache: 'no-store', signal: request.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Purchase cache unavailable.');
        setView(await response.json());
      })
      .catch(() => {
        if (!request.signal.aborted) setError(true);
      });
    return () => request.abort();
  }, []);

  async function refresh(restart = false) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError(false);
    try {
      async function post(body: { action: 'start' } | { action: 'advance' | 'restart'; jobId: string }): Promise<PurchaseView> {
        const response = await fetch(endpoint, {
          method: 'POST',
          cache: 'no-store',
          signal: controller.current?.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error('Purchase sync paused.');
        const data = (await response.json()) as PurchaseView;
        setView(data);
        return data;
      }
      let data = await post(restart && view?.job ? { action: 'restart', jobId: view.job.id } : { action: 'start' });
      // Each request checkpoints a bounded slice; a later visit resumes the same durable job.
      while (data.job && !controller.current?.signal.aborted) {
        data = await post({ action: 'advance', jobId: data.job.id });
        if (data.job?.error) {
          setError(true);
          break;
        }
      }
    } catch {
      if (!controller.current?.signal.aborted) setError(true);
    } finally {
      active.current = false;
      if (!controller.current?.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border p-4" aria-label="本人购买信息">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-semibold text-lg">本人购买信息</h2>
          <p className="text-muted-foreground text-sm">读取 Hpoi 收藏中填写的购买资料，仅站点管理员可见。</p>
        </div>
        {view?.configured && (
          <button
            type="button"
            onClick={() => refresh()}
            disabled={busy || !view.canRefresh}
            className="rounded-md bg-primary px-3 py-2 text-primary-foreground text-sm disabled:opacity-50"
          >
            {busy ? '正在同步…' : view.job ? '继续同步' : '刷新购买信息'}
          </button>
        )}
      </div>
      <div className="space-y-2 text-sm">
        <a
          href="https://www.hpoi.net/user/login"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex rounded-md border border-border px-3 py-2 hover:bg-muted"
        >
          前往 Hpoi 官网登录
        </a>
        <p className="text-muted-foreground">官网登录与博客同步分开管理；登录官网不会自动连接本站。</p>
        {view?.configured && view.canRefresh && (
          <p className="text-muted-foreground">博客同步会话已配置，刷新时将核验本人身份。</p>
        )}
      </div>
      {!view && !error && <output className="block text-muted-foreground text-sm">正在读取私有快照…</output>}
      {view && !view.configured && (
        <p className="text-muted-foreground text-sm">请先在服务器配置并确认私有存储，再启用购买信息同步。</p>
      )}
      {view?.configured && !view.canRefresh && (
        <p className="text-muted-foreground text-sm">博客尚未建立 Hpoi 同步连接，已缓存资料仍可查看。正式委托授权暂未接入。</p>
      )}
      {error && (
        <p className="text-red-600 text-sm dark:text-red-400" role="alert">
          读取或同步暂停。已保留上次快照与完成的检查点，可稍后继续重试。
        </p>
      )}
      {view?.job && (
        <div className="space-y-2">
          <output className="block text-muted-foreground text-sm">
            {view.job.phase === 'discovery' ? '正在发现本人收藏条目' : `已读取 ${view.job.done} / ${view.job.total} 条收藏记录`}
            {view.job.busy && !busy ? '，另一个窗口正在同步。' : '。'}
          </output>
          <button
            type="button"
            onClick={() => refresh(true)}
            disabled={busy || !view.canRefresh}
            title="重新读取收藏列表，保留上次完整快照"
            className="text-muted-foreground text-sm underline underline-offset-4 disabled:opacity-50"
          >
            重新开始同步
          </button>
        </div>
      )}
      {view?.snapshot ? (
        <>
          <p className="text-muted-foreground text-xs">
            上次完整更新：{new Date(view.snapshot.fetchedAt).toLocaleString()} · {view.snapshot.records.length} 条记录
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-border border-b text-muted-foreground">
                  {['商品', '状态', '购买时间', '购买渠道', '金额', '购买方式', '备注'].map((heading) => (
                    <th key={heading} scope="col" className="px-2 py-3 font-medium">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.snapshot.records.map((record) => (
                  <tr key={record.collectionId} className="border-border border-b align-top">
                    <td className="max-w-64 break-words px-2 py-3">
                      <a
                        href={`https://www.hpoi.net/hobby/${record.figureId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-primary"
                      >
                        {record.title}
                      </a>
                    </td>
                    <td className="px-2 py-3">{record.stateLabel || record.state}</td>
                    <td className="px-2 py-3">{record.orderTime ?? '未填写'}</td>
                    <td className="px-2 py-3">{record.orderWay ?? '未填写'}</td>
                    <td className="px-2 py-3 tabular-nums">
                      {record.orderMoney === null
                        ? '未填写'
                        : `${record.orderMoney} ${record.currencyLabel ?? record.orderMoneyCurrency ?? ''}`}
                    </td>
                    <td className="px-2 py-3">{record.orderFormLabel ?? record.orderForm ?? '未填写'}</td>
                    <td className="max-w-64 whitespace-pre-wrap break-words px-2 py-3">
                      {[record.tags, record.comment].filter(Boolean).join('\n') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {view.snapshot.records.length === 0 && (
            <p className="text-muted-foreground text-sm">该次完整同步没有发现收藏购买记录。</p>
          )}
        </>
      ) : (
        view?.configured && <p className="text-muted-foreground text-sm">尚无完整快照。点击刷新后读取本人收藏资料。</p>
      )}
    </section>
  );
}
