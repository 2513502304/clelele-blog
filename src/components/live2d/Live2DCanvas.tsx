import { createLive2DAssetRequestHook } from '@lib/live2d/asset-delivery';
import {
  LIVE2D_DIRECT_ASSET_BASE_URL,
  LIVE2D_DIRECT_ASSET_DELIVERY_ENABLED,
  LIVE2D_FALLBACK_ASSET_BASE_PATH,
} from '@lib/live2d/client-asset-config';
import type { Live2DRendererPhase, Live2DRendererSelection } from '@lib/live2d/renderer';
import { Live2DRenderer } from '@lib/live2d/renderer';
import { useEffect, useMemo, useRef } from 'react';

interface Props {
  selection: Live2DRendererSelection;
  releaseId: string;
  active: boolean;
  retryNonce: number;
  getInteractionRoot: () => HTMLElement | null;
  onPhase: (phase: Live2DRendererPhase, error?: unknown) => void;
  onTap: (area: string) => void;
  onRenderer: (renderer: Live2DRenderer | null) => void;
}

/** Canvas owns exactly one renderer for the lifetime of the persistent React island. */
export function Live2DCanvas({
  selection,
  releaseId,
  active,
  retryNonce,
  getInteractionRoot,
  onPhase,
  onTap,
  onRenderer,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Live2DRenderer | null>(null);
  const onPhaseRef = useRef(onPhase);
  const onTapRef = useRef(onTap);
  useEffect(() => {
    onPhaseRef.current = onPhase;
    onTapRef.current = onTap;
  }, [onPhase, onTap]);
  const request = useMemo(
    () =>
      createLive2DAssetRequestHook({
        releaseId,
        directBaseUrl: new URL(LIVE2D_DIRECT_ASSET_BASE_URL),
        fallbackBaseUrl: new URL(LIVE2D_FALLBACK_ASSET_BASE_PATH, window.location.origin),
        directEnabled: LIVE2D_DIRECT_ASSET_DELIVERY_ENABLED,
      }),
    [releaseId],
  );
  // 构造参数只作兜底；每次 release 加载都传入自己的请求钩子，因此切换服装不会重建 canvas 唯一 renderer。
  const initialRequestRef = useRef(request);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new Live2DRenderer({
      canvas,
      request: initialRequestRef.current,
      prepare: initialRequestRef.current.prefetch,
      ownsInput: (event) => Boolean(getInteractionRoot()?.contains(event.target as Node)),
      onPhase: (phase, error) => onPhaseRef.current(phase, error),
      onTap: (area) => onTapRef.current(area),
    });
    rendererRef.current = renderer;
    onRenderer(renderer);
    return () => {
      onRenderer(null);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [getInteractionRoot, onRenderer]);

  useEffect(() => {
    if (!active || !rendererRef.current) return;
    void rendererRef.current
      .load(
        { ...selection, key: `${selection.key}:${retryNonce}` },
        {
          request,
          prepare: request.prefetch,
        },
      )
      .catch(() => {
        // Recoverable state and retry controls are published through onPhase.
      });
  }, [active, request, retryNonce, selection]);

  return <canvas ref={canvasRef} className="live2d-canvas" />;
}
