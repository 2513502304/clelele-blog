import { hpoiConfig } from '@constants/site-config';
import { fetchHpoiCollection } from '@lib/hpoi';
import { HPOI_CACHE_CONTROL, HPOI_CACHE_TAG } from '@lib/hpoi/cache';
import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * 将 Hpoi 抓取集中在服务端，并以可过期旧值兜底短暂的上游故障；浏览器只消费结构化快照。
 */
export const GET: APIRoute = async () => {
  if (!hpoiConfig) return new Response('Hpoi collection is disabled.', { status: 404 });

  try {
    const data = await fetchHpoiCollection(hpoiConfig.userId);
    return Response.json(data, {
      headers: {
        // Vercel 缓存新鲜结果 30 分钟；Hpoi 短暂不可用时可继续提供最多 24 小时的过期快照。
        'cache-control': HPOI_CACHE_CONTROL,
        // 管理端仅清理 Hpoi 数据，不影响 Gallery 图片、音乐等其他 CDN 缓存。
        'vercel-cache-tag': HPOI_CACHE_TAG,
      },
    });
  } catch (error) {
    console.error('[hpoi] Failed to load collection:', error);
    return Response.json({ error: 'Failed to load Hpoi collection.' }, { status: 502 });
  }
};
