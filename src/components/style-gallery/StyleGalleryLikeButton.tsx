import { Icon } from '@iconify/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StyleGalleryViewer } from '@/types/style-gallery';

interface ViewerResponse {
  authEnabled: boolean;
  viewer: StyleGalleryViewer | null;
  likedExampleIds: string[];
}

interface LikeMutationResponse {
  liked: boolean;
  likeCount: number;
}

export interface StyleGalleryLikeLabels {
  like: string;
  unlike: string;
  loginRequired: string;
  unavailable: string;
}

export interface StyleGalleryLikesController {
  authEnabled: boolean;
  viewer: StyleGalleryViewer | null;
  getCount: (exampleId: string) => number;
  isLiked: (exampleId: string) => boolean;
  isPending: (exampleId: string) => boolean;
  toggle: (exampleId: string) => void;
}

/**
 * 单页只创建一个 controller：SSR 提供计数，客户端仅补取当前 GitHub 用户点赞过的 ID，
 * 避免每张图片各发一个请求或重复下载公开计数。
 */
export function useStyleGalleryLikes(initialCounts: Record<string, number>): StyleGalleryLikesController {
  const [counts, setCounts] = useState(initialCounts);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<StyleGalleryViewer | null>(null);
  // 登录能力在同源状态接口确认前保持关闭，避免首屏极短窗口内误跳转到未配置的 OAuth 路由。
  const [authEnabled, setAuthEnabled] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/style-gallery/likes', { signal: controller.signal, credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<ViewerResponse>;
      })
      .then((data) => {
        setAuthEnabled(data.authEnabled);
        setViewer(data.viewer);
        setLikedIds(new Set(data.likedExampleIds));
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('[style-gallery] Failed to load the like viewer session.', error);
        }
      });
    return () => controller.abort();
  }, []);

  const toggle = useCallback(
    (exampleId: string) => {
      if (!authEnabled) return;
      if (!viewer) {
        const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.assign(`/api/style-gallery/auth/github/login?returnTo=${encodeURIComponent(returnTo)}`);
        return;
      }
      if (pendingIds.has(exampleId)) return;

      const wasLiked = likedIds.has(exampleId);
      const nextLiked = !wasLiked;
      const previousCount = counts[exampleId] ?? 0;
      setPendingIds((current) => new Set(current).add(exampleId));
      setLikedIds((current) => {
        const next = new Set(current);
        nextLiked ? next.add(exampleId) : next.delete(exampleId);
        return next;
      });
      setCounts((current) => ({ ...current, [exampleId]: Math.max(0, previousCount + (nextLiked ? 1 : -1)) }));

      fetch('/api/style-gallery/likes', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ exampleId, liked: nextLiked }),
      })
        .then(async (response) => {
          if (response.status === 401) {
            const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            window.location.assign(`/api/style-gallery/auth/github/login?returnTo=${encodeURIComponent(returnTo)}`);
            throw new Error('GitHub session expired.');
          }
          if (!response.ok) throw new Error(await response.text());
          return response.json() as Promise<LikeMutationResponse>;
        })
        .then((data) => {
          setCounts((current) => ({ ...current, [exampleId]: data.likeCount }));
          setLikedIds((current) => {
            const next = new Set(current);
            data.liked ? next.add(exampleId) : next.delete(exampleId);
            return next;
          });
        })
        .catch((error) => {
          console.error('[style-gallery] Failed to update an example like.', error);
          setCounts((current) => ({ ...current, [exampleId]: previousCount }));
          setLikedIds((current) => {
            const next = new Set(current);
            wasLiked ? next.add(exampleId) : next.delete(exampleId);
            return next;
          });
        })
        .finally(() => {
          setPendingIds((current) => {
            const next = new Set(current);
            next.delete(exampleId);
            return next;
          });
        });
    },
    [authEnabled, counts, likedIds, pendingIds, viewer],
  );

  return useMemo(
    () => ({
      authEnabled,
      viewer,
      getCount: (exampleId: string) => counts[exampleId] ?? 0,
      isLiked: (exampleId: string) => likedIds.has(exampleId),
      isPending: (exampleId: string) => pendingIds.has(exampleId),
      toggle,
    }),
    [authEnabled, counts, likedIds, pendingIds, toggle, viewer],
  );
}

interface LikeButtonProps {
  exampleId: string;
  controller: StyleGalleryLikesController;
  labels: StyleGalleryLikeLabels;
  className?: string;
}

export function StyleGalleryLikeButton({ exampleId, controller, labels, className = '' }: LikeButtonProps) {
  const liked = controller.isLiked(exampleId);
  const pending = controller.isPending(exampleId);
  const title = !controller.authEnabled
    ? labels.unavailable
    : !controller.viewer
      ? labels.loginRequired
      : liked
        ? labels.unlike
        : labels.like;
  return (
    <button
      type="button"
      onClick={() => controller.toggle(exampleId)}
      disabled={!controller.authEnabled || pending}
      aria-pressed={liked}
      aria-label={`${title}: ${controller.getCount(exampleId)}`}
      title={title}
      className={`inline-flex h-9 min-w-14 items-center justify-center gap-1.5 rounded-full border border-white/70 bg-white/92 px-2.5 font-bold text-xs shadow-md backdrop-blur transition hover:border-rose-300 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950/90 ${liked ? 'text-rose-500' : 'text-gray-600 dark:text-gray-200'} ${className}`}
    >
      <Icon
        icon={pending ? 'ri:loader-4-line' : liked ? 'ri:heart-3-fill' : 'ri:heart-3-line'}
        className={`size-4 ${pending ? 'animate-spin' : ''}`}
      />
      <span className="min-w-3 text-center tabular-nums">{controller.getCount(exampleId)}</span>
    </button>
  );
}
