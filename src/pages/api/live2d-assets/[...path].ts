import { live2dEnabled } from '@constants/site-config';
import { createLive2DAssetRouteHandler } from '@lib/live2d/asset-route';
import { createLive2DAssetOriginReader, getLive2DReadS3Config } from '@lib/live2d/assets';
import type { APIRoute } from 'astro';

export const prerender = false;

const originReader = createLive2DAssetOriginReader({
  // 凭证只在 allowlist 校验通过后的首次 GET 中读取，不进入客户端 bundle 或错误日志。
  config: () => getLive2DReadS3Config(process.env),
});

type Live2DAssetDeliveryMode = 'auto' | 'enabled' | 'disabled';

function isLive2DAssetDeliveryEnabled(): boolean {
  const configuredMode = process.env.LIVE2D_ASSET_DELIVERY_MODE ?? 'auto';
  const mode: Live2DAssetDeliveryMode =
    configuredMode === 'auto' || configuredMode === 'enabled' || configuredMode === 'disabled' ? configuredMode : 'disabled';
  if (mode === 'disabled') return false;
  if (mode === 'enabled') return true;
  return live2dEnabled;
}

const handle = createLive2DAssetRouteHandler(originReader, isLive2DAssetDeliveryEnabled);

const route: APIRoute = ({ params, request }) => handle(request, params.path);

export const GET = route;
export const HEAD = route;
export const ALL = route;
