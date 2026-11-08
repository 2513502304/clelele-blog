import type { HpoiCollectionResponse } from '@/types/hpoi';
import { invalidateCdnTags } from '../cdn-cache';
import { fetchHpoiCollection } from './fetch';

export const HPOI_CACHE_TAG = 'hpoi-collection';
export const HPOI_CACHE_CONTROL = 'public, s-maxage=1800, stale-while-revalidate=86400';

/**
 * 立即删除当前部署平台上带有 Hpoi tag 的 CDN 响应，使下一次公开 GET 重新抓取。
 * Cloudflare 容器需要已配置的失效桥接；Vercel 保持官方 SDK 的本地开发行为。
 */
export async function deleteHpoiCdnCache(): Promise<void> {
  await invalidateCdnTags(HPOI_CACHE_TAG, 'purge');
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
