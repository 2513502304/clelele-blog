import type { Live2DRendererPhase, Live2DRendererSelection } from '@lib/live2d/renderer';
import { Live2DRenderer } from '@lib/live2d/renderer';
import { useEffect, useRef } from 'react';

interface Props {
  selection: Live2DRendererSelection;
  active: boolean;
  retryNonce: number;
  onPhase: (phase: Live2DRendererPhase, error?: unknown) => void;
  onTap: (area: string) => void;
  onRenderer: (renderer: Live2DRenderer | null) => void;
}

/** Canvas owns exactly one renderer for the lifetime of the persistent React island. */
export function Live2DCanvas({ selection, active, retryNonce, onPhase, onTap, onRenderer }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Live2DRenderer | null>(null);
  const onPhaseRef = useRef(onPhase);
  const onTapRef = useRef(onTap);
  useEffect(() => {
    onPhaseRef.current = onPhase;
    onTapRef.current = onTap;
  }, [onPhase, onTap]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new Live2DRenderer({
      canvas,
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
  }, [onRenderer]);

  useEffect(() => {
    if (!active || !rendererRef.current) return;
    void rendererRef.current.load({ ...selection, key: `${selection.key}:${retryNonce}` }).catch(() => {
      // Recoverable state and retry controls are published through onPhase.
    });
  }, [active, retryNonce, selection]);

  return <canvas ref={canvasRef} className="live2d-canvas" />;
}
