import type { Live2DAssetDescriptor } from './asset-registry';
import {
  createLive2DAssetHeaders,
  type Live2DAssetOriginReader,
  Live2DAssetPathError,
  Live2DOriginError,
  Live2DReadCredentialsError,
  resolveLive2DAsset,
} from './assets';

const forbiddenRequestHeaders = ['authorization', 'proxy-authorization', 'if-range'] as const;

interface ByteRange {
  start: number;
  end: number;
}

function parseByteRange(value: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const startText = match[1];
  const endText = match[2];
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

/** Streams one allowlisted byte range without buffering the model or voice file in the Function. */
function createByteRangeStream(body: ReadableStream<Uint8Array>, range: ByteRange, sourceSize: number) {
  const reader = body.getReader();
  let sourceOffset = 0;
  let remaining = range.end - range.start + 1;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (remaining > 0) {
          const result = await reader.read();
          if (result.done) throw new Error('Live2D origin ended before the requested byte range.');
          const chunk = result.value;
          const chunkStart = sourceOffset;
          sourceOffset += chunk.byteLength;
          if (sourceOffset <= range.start) continue;
          const sliceStart = Math.max(0, range.start - chunkStart);
          const sliceLength = Math.min(remaining, chunk.byteLength - sliceStart);
          controller.enqueue(chunk.subarray(sliceStart, sliceStart + sliceLength));
          remaining -= sliceLength;
        }
        if (range.end === sourceSize - 1) {
          const result = await reader.read();
          if (!result.done) throw new Error('Live2D origin returned more bytes than the immutable manifest declares.');
        } else {
          await reader.cancel('Requested byte range completed.');
        }
        controller.close();
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

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
      const rangeHeader = request.headers.get('range');
      const range = rangeHeader ? parseByteRange(rangeHeader, asset.size) : null;
      if (rangeHeader && !range) {
        return new Response('Requested range not satisfiable.', {
          status: 416,
          headers: { 'accept-ranges': 'bytes', 'content-range': `bytes */${asset.size}` },
        });
      }
      if (request.method === 'HEAD') {
        await reader.verify(asset, request.signal);
        return new Response(null, { status: 200, headers });
      }

      const upstream = await reader.read(asset, request.signal);
      if (range) {
        headers.set('content-length', String(range.end - range.start + 1));
        headers.set('content-range', `bytes ${range.start}-${range.end}/${asset.size}`);
        if (!upstream.body) throw new Live2DOriginError('Live2D origin returned an empty response body.', false);
        return new Response(createByteRangeStream(upstream.body, range, asset.size), { status: 206, headers });
      }
      return new Response(upstream.body, { status: 200, headers });
    } catch (error) {
      // 签名 URL 和只读凭证不进入日志或公开错误正文。
      return errorResponse(error);
    }
  };
}
