import { HPOI_ORIGIN } from '@lib/hpoi';
import { isAllowedHpoiImageUrl } from '@lib/hpoi/image';
import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * 同源代理 Hpoi 图片，统一补充 Referer、校验响应类型并缓存结果。
 * 来源白名单由 `isAllowedHpoiImageUrl` 控制，防止该接口退化为任意 URL 代理。
 */
export const GET: APIRoute = async ({ url }) => {
  const sourceUrl = url.searchParams.get('source');
  if (!sourceUrl || !isAllowedHpoiImageUrl(sourceUrl)) {
    return new Response('Invalid Hpoi image URL.', { status: 400 });
  }

  try {
    const upstream = await fetch(sourceUrl, {
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        referer: `${HPOI_ORIGIN}/`,
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137 Safari/537.36',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });

    const contentType = upstream.headers.get('content-type');
    if (!upstream.ok || !contentType?.startsWith('image/')) {
      return new Response('Failed to load Hpoi image.', { status: 502 });
    }

    return new Response(upstream.body, {
      headers: {
        'cache-control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000',
        'content-type': contentType,
      },
    });
  } catch (error) {
    console.error('[hpoi] Failed to proxy image:', error);
    return new Response('Failed to load Hpoi image.', { status: 502 });
  }
};
