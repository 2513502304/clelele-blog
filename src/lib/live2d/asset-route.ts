import type { Live2DAssetDescriptor } from './asset-registry';
import {
  createLive2DAssetHeaders,
  type Live2DAssetOriginReader,
  Live2DAssetPathError,
  Live2DOriginError,
  Live2DReadCredentialsError,
  resolveLive2DAsset,
} from './assets';

const forbiddenRequestHeaders = ['authorization', 'proxy-authorization', 'range', 'if-range'] as const;

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
  if (error instanceof Live2DReadCredentialsError) {
    return new Response('Failed to load Live2D asset.', { status: 503 });
  }
  return new Response('Failed to load Live2D asset.', { status: 500 });
}

/** 与框架无关的路由核心；Astro 入口负责注入凭证读取器、manifest 解析器和独立回源开关。 */
export function createLive2DAssetRouteHandler(
  reader: Live2DAssetOriginReader,
  enabled: () => boolean = () => true,
  resolve: (path: string) => Live2DAssetDescriptor | Promise<Live2DAssetDescriptor> = resolveLive2DAsset,
) {
  return async (request: Request, rawPath: string | undefined): Promise<Response> => {
    if (!enabled()) return new Response('Live2D asset not found.', { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed.', {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }
    const url = new URL(request.url);
    if (url.search || forbiddenRequestHeaders.some((header) => request.headers.has(header))) {
      return new Response('Unsupported Live2D asset request variant.', {
        status: 400,
      });
    }

    try {
      const asset = await resolve(rawPath ?? '');
      const headers = createLive2DAssetHeaders(asset);
      if (request.method === 'HEAD') {
        await reader.verify(asset, request.signal);
        return new Response(null, { status: 200, headers });
      }

      const upstream = await reader.read(asset, request.signal);
      return new Response(upstream.body, { status: 200, headers });
    } catch (error) {
      // 签名 URL 和只读凭证不进入日志或公开错误正文。
      return errorResponse(error);
    }
  };
}
