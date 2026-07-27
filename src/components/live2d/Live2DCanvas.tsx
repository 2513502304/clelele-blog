import { createLive2DAssetRequestHook } from '@lib/live2d/assets';
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
  onPhaseRef.current = onPhase;
  onTapRef.current = onTap;
  const request = useMemo(
    () =>
      createLive2DAssetRequestHook({
        releaseId,
        directBaseUrl: new URL('https://s3.hf.co/clelele0722/raw-datasets/bestdori/'),
        fallbackBaseUrl: new URL('/api/live2d-assets/', window.location.origin),
        // 当前 HF endpoint 未通过浏览器 CORS canary；部署验证通过后只需切换这一策略。
        directEnabled: false,
      }),
    [releaseId],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new Live2DRenderer({
      canvas,
      request,
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
  }, [getInteractionRoot, onRenderer, request]);

  useEffect(() => {
    if (!active || !rendererRef.current) return;
    void rendererRef.current.load({ ...selection, key: `${selection.key}:${retryNonce}` }).catch(() => {
      // Recoverable state and retry controls are published through onPhase.
    });
  }, [active, retryNonce, selection]);

  return <canvas ref={canvasRef} className="live2d-canvas" />;
}
