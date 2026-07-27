import {
  createLive2DAssetHeaders,
  createLive2DAssetOriginReader,
  getLive2DReadS3Config,
  type Live2DAssetOriginReader,
  Live2DAssetPathError,
  Live2DOriginError,
  resolveLive2DAsset,
} from '@lib/live2d/assets';
import type { APIRoute } from 'astro';

export const prerender = false;

const forbiddenRequestHeaders = ['authorization', 'proxy-authorization', 'range', 'if-range'] as const;

const originReader = createLive2DAssetOriginReader({
  // 凭证只在 allowlist 校验通过后的首次 GET 中读取，不进入客户端 bundle 或错误日志。
  config: () => getLive2DReadS3Config(process.env),
});

function errorResponse(error: unknown): Response {
  if (error instanceof Live2DAssetPathError) {
    const status = error.code === 'invalid-path' ? 400 : error.code === 'object-too-large' ? 413 : 404;
    return new Response(status === 404 ? 'Live2D asset not found.' : error.message, { status });
  }
  if (error instanceof Live2DOriginError) {
    return new Response(error.status === 404 ? 'Live2D asset not found.' : 'Failed to load Live2D asset.', {
      status: error.status,
    });
  }
  return new Response('Failed to load Live2D asset.', { status: 500 });
}

export function createLive2DAssetRouteHandler(reader: Live2DAssetOriginReader = originReader) {
  return async (request: Request, rawPath: string | undefined): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed.', { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    const url = new URL(request.url);
    if (url.search || forbiddenRequestHeaders.some((header) => request.headers.has(header))) {
      return new Response('Unsupported Live2D asset request variant.', { status: 400 });
    }

    try {
      const asset = resolveLive2DAsset(rawPath ?? '');
      const headers = createLive2DAssetHeaders(asset);
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers });

      const upstream = await reader.read(asset);
      return new Response(upstream.body, { status: 200, headers });
    } catch (error) {
      // 签名 URL 和只读凭证都不进入日志；错误只按稳定分类映射为公开状态码。
      return errorResponse(error);
    }
  };
}

const handle = createLive2DAssetRouteHandler();

const route: APIRoute = ({ params, request }) => handle(request, params.path);

export const GET = route;
export const HEAD = route;
export const ALL = route;
