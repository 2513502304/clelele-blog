import { rewriteMetingSongs } from '@lib/music/meting-proxy';
import { getFallbackMetingApiUrl } from '@lib/music/service';
import type { APIRoute } from 'astro';

export const prerender = false;

const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_ATTEMPTS = 3;

async function fetchUpstream(url: URL): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (response.ok || (response.status < 500 && response.status !== 429)) return response;
      lastError = new Error(`Fallback Meting API returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < REQUEST_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** (attempt - 1)));
  }
  throw lastError instanceof Error ? lastError : new Error('Fallback Meting API request failed.');
}

/**
 * 歌单元数据仍由既有 Meting 服务提供；网易云歌曲 URL 被替换为本站同源路由，
 * 从而在不暴露 Cookie 的前提下优先解析登录音源。
 */
export const GET: APIRoute = async ({ url }) => {
  const server = url.searchParams.get('server') ?? '';
  const type = url.searchParams.get('type') ?? '';
  const id = url.searchParams.get('id') ?? '';
  if (!server || !type || !id) return new Response('Missing Meting parameters.', { status: 400 });

  const upstream = getFallbackMetingApiUrl();
  upstream.search = new URLSearchParams({ server, type, id }).toString();
  try {
    const response = await fetchUpstream(upstream);
    if (!response.ok) return new Response('Fallback Meting API failed.', { status: response.status });
    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) return Response.json([]);

    const songs = rewriteMetingSongs(raw, server);
    return Response.json(songs, {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' },
    });
  } catch (error) {
    console.error('[music] Failed to proxy Meting metadata.', error);
    return new Response('Music metadata is temporarily unavailable.', { status: 503 });
  }
};
