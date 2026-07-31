import { ErrorBoundary, InlineErrorFallback } from '@components/common';
import { Icon } from '@iconify/react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface SessionStatus {
  configured: boolean;
  connected: boolean;
  createdAt?: string;
  updatedAt?: string;
  account?: { userId?: number; nickname?: string };
  health?: { checkedAt: string; healthy: boolean; message: string };
}

interface QrLogin {
  key: string;
  qrImage: string;
}

const QR_POLL_INTERVAL_MS = 2_000;

async function responseError(response: Response): Promise<Error> {
  return new Error((await response.text().catch(() => '')) || `请求失败：${response.status}`);
}

function formatDate(value?: string): string {
  if (!value) return '暂无';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value));
}

function MusicSessionAdminContent() {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [qr, setQr] = useState<QrLogin | null>(null);
  const [qrMessage, setQrMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'qr' | 'health' | null>(null);
  const [error, setError] = useState('');
  const pollTimer = useRef<number | null>(null);
  const polling = useRef(false);
  const actionRef = useRef<'qr' | 'health' | null>(null);

  const beginAction = (next: 'qr' | 'health'): boolean => {
    // React state does not update synchronously, so the ref closes the double-click window.
    if (actionRef.current !== null) return false;
    actionRef.current = next;
    setAction(next);
    return true;
  };

  const endAction = () => {
    actionRef.current = null;
    setAction(null);
  };

  const stopPolling = useCallback(() => {
    polling.current = false;
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const loadStatus = useCallback(async () => {
    const response = await fetch('/api/music/session', { cache: 'no-store' });
    if (!response.ok) throw await responseError(response);
    setStatus((await response.json()) as SessionStatus);
  }, []);

  useEffect(() => {
    loadStatus()
      .catch((reason) => setError(reason instanceof Error ? reason.message : '无法读取网易云会话状态。'))
      .finally(() => setLoading(false));
    return stopPolling;
  }, [loadStatus, stopPolling]);

  const pollQrStatus = useCallback(
    async (key: string) => {
      if (!polling.current) return;
      try {
        const response = await fetch('/api/music/session/qr-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });
        if (!response.ok) throw await responseError(response);
        const result = (await response.json()) as { code: number; message?: string };
        if (result.code === 803) {
          stopPolling();
          setQr(null);
          setQrMessage('登录成功，会话已加密保存。');
          await loadStatus();
          return;
        }
        if (result.code === 800) {
          stopPolling();
          setQrMessage('二维码已过期，请重新生成。');
          return;
        }
        setQrMessage(result.code === 802 ? '已扫码，请在网易云音乐中确认登录。' : '等待扫码…');
      } catch (reason) {
        stopPolling();
        setError(reason instanceof Error ? reason.message : '检查二维码状态失败。');
        return;
      }
      pollTimer.current = window.setTimeout(() => void pollQrStatus(key), QR_POLL_INTERVAL_MS);
    },
    [loadStatus, stopPolling],
  );

  const createQr = async () => {
    if (!beginAction('qr')) return;
    stopPolling();
    setError('');
    setQrMessage('正在生成二维码…');
    try {
      const response = await fetch('/api/music/session/qr', { method: 'POST' });
      if (!response.ok) throw await responseError(response);
      const nextQr = (await response.json()) as QrLogin;
      setQr(nextQr);
      setQrMessage('请使用网易云音乐 App 扫码。');
      polling.current = true;
      pollTimer.current = window.setTimeout(() => void pollQrStatus(nextQr.key), QR_POLL_INTERVAL_MS);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '生成二维码失败。');
      setQrMessage('');
    } finally {
      endAction();
    }
  };

  const checkHealth = async () => {
    if (!beginAction('health')) return;
    setError('');
    try {
      const response = await fetch('/api/music/session/health', { method: 'POST' });
      if (!response.ok) throw await responseError(response);
      await loadStatus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '健康检查失败。');
    } finally {
      endAction();
    }
  };

  return (
    <section className="not-prose space-y-5" aria-busy={loading}>
      <header>
        <p className="font-medium text-primary text-sm">Owner only</p>
        <h1 className="mt-1 font-semibold text-2xl text-foreground">网易云播放会话</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-6">
          播放器优先使用这里保存的登录态解析完整音源；登录态失效或歌曲无权限时自动回退到原有 Meting 试听地址。
        </p>
      </header>

      {error && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-destructive text-sm"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-base text-foreground">当前状态</h2>
            <span
              className={`inline-flex items-center gap-1.5 text-sm ${status?.connected ? 'text-emerald-600' : 'text-muted-foreground'}`}
            >
              <span className={`size-2 rounded-full ${status?.connected ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
              {status?.connected ? '已连接' : '未连接'}
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">账号</dt>
            <dd className="text-foreground">{status?.account?.nickname ?? status?.account?.userId ?? '暂无'}</dd>
            <dt className="text-muted-foreground">会话更新</dt>
            <dd className="text-foreground">{formatDate(status?.updatedAt)}</dd>
            <dt className="text-muted-foreground">最近检查</dt>
            <dd className="text-foreground">{formatDate(status?.health?.checkedAt)}</dd>
          </dl>
          {status?.health && (
            <p className={`mt-4 text-sm ${status.health.healthy ? 'text-emerald-600' : 'text-amber-600'}`}>
              {status.health.message}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-sm disabled:opacity-50"
              onClick={createQr}
              disabled={action !== null}
            >
              <Icon
                icon={action === 'qr' ? 'ri:loader-4-line' : 'ri:qr-code-line'}
                className={action === 'qr' ? 'animate-spin' : ''}
              />
              {status?.connected ? '重新扫码登录' : '扫码登录'}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 font-medium text-foreground text-sm disabled:opacity-50"
              onClick={checkHealth}
              disabled={!status?.connected || action !== null}
            >
              <Icon
                icon={action === 'health' ? 'ri:loader-4-line' : 'ri:heartbeat-line'}
                className={action === 'health' ? 'animate-spin' : ''}
              />
              检查登录状态
            </button>
          </div>
        </section>

        <section className="flex min-h-72 flex-col items-center justify-center rounded-md border border-border bg-card p-4 text-center">
          {qr ? (
            <>
              <img src={qr.qrImage} alt="网易云音乐登录二维码" className="size-52 rounded-md bg-white p-2" />
              <p className="mt-3 text-muted-foreground text-sm">{qrMessage}</p>
            </>
          ) : (
            <>
              <Icon icon="ri:netease-cloud-music-line" className="size-12 text-primary" />
              <p className="mt-3 text-muted-foreground text-sm">{qrMessage || '生成二维码后在这里完成登录。'}</p>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

export default function MusicSessionAdmin() {
  return (
    <ErrorBoundary FallbackComponent={InlineErrorFallback}>
      <MusicSessionAdminContent />
    </ErrorBoundary>
  );
}
