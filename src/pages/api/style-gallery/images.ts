import { createStyleGallerySignedImageUrl, getStyleGallerySignedImageRedirectCacheSeconds } from '@lib/hf-s3-presign';
import {
  createStyleGalleryImageApiPath,
  isAllowedStyleGalleryImageKey,
  STYLE_GALLERY_IMAGE_SIGN_BATCH_SIZE,
} from '@lib/style-gallery-image-key';
import type { APIRoute } from 'astro';

export const prerender = false;

/** 一次性生成 lightbox 导航窗口的签名 URL，避免键盘翻页时逐张等待 302。 */
export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON body.', { status: 400 });
  }
  const keys = typeof body === 'object' && body !== null && 'keys' in body ? (body as { keys?: unknown }).keys : null;
  if (
    !Array.isArray(keys) ||
    keys.length === 0 ||
    keys.length > STYLE_GALLERY_IMAGE_SIGN_BATCH_SIZE ||
    keys.some((key) => typeof key !== 'string')
  ) {
    return new Response(`keys must contain between 1 and ${STYLE_GALLERY_IMAGE_SIGN_BATCH_SIZE} image keys.`, {
      status: 400,
    });
  }
  const uniqueKeys = [...new Set(keys as string[])];
  if (uniqueKeys.some((key) => !isAllowedStyleGalleryImageKey(key))) {
    return new Response('Invalid style gallery image key.', { status: 400 });
  }

  try {
    const cacheSeconds = getStyleGallerySignedImageRedirectCacheSeconds();
    const expiresAt = import.meta.env.DEV ? null : cacheSeconds > 0 ? Date.now() + cacheSeconds * 1000 : undefined;
    return Response.json({
      images: Object.fromEntries(
        uniqueKeys.map((key) => [
          createStyleGalleryImageApiPath(key),
          import.meta.env.DEV ? createStyleGalleryImageApiPath(key) : createStyleGallerySignedImageUrl(key),
        ]),
      ),
      // 0 表示不声明服务端缓存窗口；省略字段后客户端使用短期兼容窗口，避免每次导航重复签名。
      ...(expiresAt === undefined ? {} : { expiresAt }),
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Failed to sign image URLs.', { status: 500 });
  }
};
