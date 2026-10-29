import type { Live2DLoadProgress, Live2DRendererPhase, Live2DRendererSelection } from '@lib/live2d/renderer';
import { Live2DRenderer } from '@lib/live2d/renderer';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  selection: Live2DRendererSelection;
  active: boolean;
  retryNonce: number;
  onPhase: (phase: Live2DRendererPhase, error?: unknown) => void;
  onProgress: (progress: Live2DLoadProgress) => void;
  onTap: (area: string) => void;
  onRenderer: (renderer: Live2DRenderer | null) => void;
  studioHost?: HTMLElement | null;
}

/** Canvas owns exactly one renderer for the lifetime of the persistent React island. */
export function Live2DCanvas({ selection, active, retryNonce, onPhase, onProgress, onTap, onRenderer, studioHost }: Props) {
  const [container] = useState(() => Object.assign(document.createElement('div'), { className: 'live2d-canvas-host' }));
  const anchorRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Live2DRenderer | null>(null);
  const onPhaseRef = useRef(onPhase);
  const progressRef = useRef(onProgress);
  const onTapRef = useRef(onTap);
  // Move the same portal container, preserving its canvas, decoded assets and WebGL context.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    (studioHost ?? anchor)?.append(container);
    return () => {
      if (anchor) anchor.append(container);
    };
  }, [container, studioHost]);
  useEffect(() => {
    onPhaseRef.current = onPhase;
    progressRef.current = onProgress;
    onTapRef.current = onTap;
  }, [onPhase, onProgress, onTap]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new Live2DRenderer({
      canvas,
      onPhase: (phase, error) => onPhaseRef.current(phase, error),
      onProgress: (progress) => progressRef.current(progress),
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

  return (
    <>
      <div ref={anchorRef} className="live2d-canvas-anchor" />
      {createPortal(<canvas ref={canvasRef} className="live2d-canvas" />, container)}
    </>
  );
}
