import { dangerouslyDeleteByTag } from '@vercel/functions';
import type { HpoiCollectionResponse } from '@/types/hpoi';
import { fetchHpoiCollection } from './fetch';

export const HPOI_CACHE_TAG = 'hpoi-collection';
export const HPOI_CACHE_CONTROL = 'public, s-maxage=1800, stale-while-revalidate=86400';

/**
 * 立即删除带有 Hpoi tag 的 Vercel CDN 响应，使下一次公开 GET 在前台重新抓取并填充缓存。
 * 本地开发没有 Vercel Function 上下文时，官方 SDK 会安全地退化为空操作。
 */
export async function deleteHpoiCdnCache(): Promise<void> {
  await dangerouslyDeleteByTag(HPOI_CACHE_TAG);
}

interface HpoiCacheRefreshDependencies {
  fetchCollection: (userId: string) => Promise<HpoiCollectionResponse>;
  deleteCache: () => Promise<void>;
}

const DEFAULT_REFRESH_DEPENDENCIES: HpoiCacheRefreshDependencies = {
  fetchCollection: fetchHpoiCollection,
  deleteCache: deleteHpoiCdnCache,
};

/** 先验证一份完整的新快照，再删除旧缓存；抓取失败时保留现有可用数据。 */
export async function refreshHpoiCollectionCache(
  userId: string,
  dependencies: HpoiCacheRefreshDependencies = DEFAULT_REFRESH_DEPENDENCIES,
): Promise<HpoiCollectionResponse> {
  const data = await dependencies.fetchCollection(userId);
  await dependencies.deleteCache();
  return data;
}
