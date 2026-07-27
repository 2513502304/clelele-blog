import { type FloatingRootContext, useDismiss } from '@floating-ui/react';
import { getLive2DFocusNodes, isLive2DOwnedTarget } from '@lib/live2d/focus-scope';

/** Keeps Live2D controls interactive and inside the focus scope of immersive dialogs. */
export function useLive2DAwareDismiss(context: FloatingRootContext) {
  const dismiss = useDismiss(context, {
    outsidePressEvent: 'mousedown',
    outsidePress: (event) => !isLive2DOwnedTarget(event.target),
  });

  return { dismiss, getInsideElements: getLive2DFocusNodes };
}
