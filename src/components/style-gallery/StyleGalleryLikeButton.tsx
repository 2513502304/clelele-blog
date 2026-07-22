import { Icon } from '@iconify/react';
import { type ImageLightboxLikeAction, type ImageLightboxLikeMutationResult, syncImageLightboxLikes } from '@store/modal';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StyleGalleryViewer } from '@/types/style-gallery';

interface ViewerResponse {
  authEnabled: boolean;
  viewer: StyleGalleryViewer | null;
  likedExampleIds: string[];
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
  toggle: (exampleId: string) => Promise<ImageLightboxLikeMutationResult | null>;
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
  // popup 会持有 toggle 的长期引用；ref 让该函数始终读取最新状态，避免连续点赞使用过期闭包。
  const countsRef = useRef(counts);
  const likedIdsRef = useRef(likedIds);
  const pendingIdsRef = useRef(pendingIds);
  const viewerRef = useRef(viewer);
  const authEnabledRef = useRef(authEnabled);

  useEffect(() => {
    countsRef.current = counts;
    likedIdsRef.current = likedIds;
    pendingIdsRef.current = pendingIds;
    viewerRef.current = viewer;
    authEnabledRef.current = authEnabled;
  }, [authEnabled, counts, likedIds, pendingIds, viewer]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/style-gallery/likes', { signal: controller.signal, credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<ViewerResponse>;
      })
      .then((data) => {
        authEnabledRef.current = data.authEnabled;
        viewerRef.current = data.viewer;
        likedIdsRef.current = new Set(data.likedExampleIds);
        setAuthEnabled(data.authEnabled);
        setViewer(data.viewer);
        setLikedIds(likedIdsRef.current);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('[style-gallery] Failed to load the like viewer session.', error);
        }
      });
    return () => controller.abort();
  }, []);

  const toggle = useCallback(async (exampleId: string): Promise<ImageLightboxLikeMutationResult | null> => {
    if (!authEnabledRef.current) return null;
    if (!viewerRef.current) {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.assign(`/api/style-gallery/auth/github/login?returnTo=${encodeURIComponent(returnTo)}`);
      return null;
    }
    if (pendingIdsRef.current.has(exampleId)) return null;

    const wasLiked = likedIdsRef.current.has(exampleId);
    const nextLiked = !wasLiked;
    const previousCount = countsRef.current[exampleId] ?? 0;
    const optimisticCount = Math.max(0, previousCount + (nextLiked ? 1 : -1));
    pendingIdsRef.current = new Set(pendingIdsRef.current).add(exampleId);
    likedIdsRef.current = new Set(likedIdsRef.current);
    nextLiked ? likedIdsRef.current.add(exampleId) : likedIdsRef.current.delete(exampleId);
    countsRef.current = { ...countsRef.current, [exampleId]: optimisticCount };
    setPendingIds(pendingIdsRef.current);
    setLikedIds(likedIdsRef.current);
    setCounts(countsRef.current);

    try {
      const response = await fetch('/api/style-gallery/likes', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ exampleId, liked: nextLiked }),
      });
      if (response.status === 401) {
        const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.assign(`/api/style-gallery/auth/github/login?returnTo=${encodeURIComponent(returnTo)}`);
        throw new Error('GitHub session expired.');
      }
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as ImageLightboxLikeMutationResult;
      countsRef.current = { ...countsRef.current, [exampleId]: data.likeCount };
      likedIdsRef.current = new Set(likedIdsRef.current);
      data.liked ? likedIdsRef.current.add(exampleId) : likedIdsRef.current.delete(exampleId);
      setCounts(countsRef.current);
      setLikedIds(likedIdsRef.current);
      return data;
    } catch (error) {
      console.error('[style-gallery] Failed to update an example like.', error);
      countsRef.current = { ...countsRef.current, [exampleId]: previousCount };
      likedIdsRef.current = new Set(likedIdsRef.current);
      wasLiked ? likedIdsRef.current.add(exampleId) : likedIdsRef.current.delete(exampleId);
      setCounts(countsRef.current);
      setLikedIds(likedIdsRef.current);
      return { liked: wasLiked, likeCount: previousCount };
    } finally {
      pendingIdsRef.current = new Set(pendingIdsRef.current);
      pendingIdsRef.current.delete(exampleId);
      setPendingIds(pendingIdsRef.current);
    }
  }, []);

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

/** 为通用 lightbox 生成当前示例的点赞快照和稳定 mutation 回调。 */
export function createStyleGalleryLightboxLikeAction(
  exampleId: string,
  controller: StyleGalleryLikesController,
  labels: StyleGalleryLikeLabels,
): ImageLightboxLikeAction {
  return {
    exampleId,
    liked: controller.isLiked(exampleId),
    likeCount: controller.getCount(exampleId),
    pending: controller.isPending(exampleId),
    authEnabled: controller.authEnabled,
    viewerAuthenticated: Boolean(controller.viewer),
    labels,
    toggle: () => controller.toggle(exampleId),
  };
}

/** 将异步登录态和任意入口触发的点赞结果同步到当前 Gallery lightbox。 */
export function syncStyleGalleryLightboxLikes(controller: StyleGalleryLikesController): void {
  syncImageLightboxLikes((exampleId) => ({
    liked: controller.isLiked(exampleId),
    likeCount: controller.getCount(exampleId),
    pending: controller.isPending(exampleId),
    authEnabled: controller.authEnabled,
    viewerAuthenticated: Boolean(controller.viewer),
  }));
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
      onClick={() => void controller.toggle(exampleId)}
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
