import type { Live2DCore } from './renderer';

/** Lazily select the native or legacy engine; keep pinned upstream compatibility details outside the lifecycle. */
export async function createLive2DCore(canvas: HTMLCanvasElement, native: boolean): Promise<Live2DCore> {
  if (native) return (await import('./our-notes-renderer')).createOurNotesCore(canvas);
  const { init } = await import('l2d');
  const core = init(canvas) as unknown as
    | (Live2DCore & {
        getCanvas: () => HTMLCanvasElement;
        _state?: {
          l2d2Model?: {
            _drawFrameId?: number | null;
            isDrawStart?: boolean;
            startDraw?: () => void;
            draw?: () => void;
            resize?: () => void;
            live2DMgr?: {
              getModel?: () => {
                mainMotionManager?: { stopAllMotions?: () => void };
                expressionManager?: { stopAllMotions?: () => void };
              } | null;
            };
          } | null;
          l2d6Model?: {
            stop?: () => void;
            run?: () => void;
            renderFrame?: (timestamp: number, resetClock: boolean) => void;
            _subdelegates?: Array<{
              resizeCanvas?: () => void;
              getLive2DManager?: () => {
                _models?: Array<{
                  _motionManager?: { stopAllMotions?: () => void };
                  _expressionManager?: { stopAllMotions?: () => void };
                }>;
              };
            }>;
          } | null;
        };
      })
    | null;
  if (!core) throw new Error('Live2D renderer could not initialize the canvas.');

  // l2d 2.1.1 只公开模型销毁能力，没有公开暂停接口。锁定版本的 Cubism
  // 适配层保留了 RAF 控制器，因此可在不重载资产、不重置状态的情况下冻结模型。
  // 升级 l2d 时必须用真实 Cubism 2/6 模型重新验证这些内部字段。
  let renderingPaused = false;
  let editFrame: number | null = null;
  const drawStill = () => {
    if (editFrame !== null) cancelAnimationFrame(editFrame);
    editFrame = null;
    core._state?.l2d2Model?.draw?.();
    core._state?.l2d6Model?.renderFrame?.(performance.now(), true);
  };
  const setParams = core.setParams?.bind(core);
  const requestStill = () => {
    if (renderingPaused && editFrame === null) editFrame = requestAnimationFrame(drawStill);
  };
  core.setParams = (params) => {
    setParams?.(params);
    // Keep the paused editor responsive without restarting its continuous animation clock.
    requestStill();
  };
  core.captureFrame = () => {
    // Reading an unchanged paused pose must not advance Cubism 2's wall-clock animation.
    if (editFrame !== null) drawStill();
    return core.getCanvas().toDataURL('image/png');
  };
  const destroy = core.destroy.bind(core);
  core.destroy = () => {
    if (editFrame !== null) cancelAnimationFrame(editFrame);
    editFrame = null;
    return destroy();
  };
  const load = core.load.bind(core);
  core.load = async (options) => {
    if (editFrame !== null) cancelAnimationFrame(editFrame);
    editFrame = null;
    renderingPaused = false;
    await load(options);
    // Cover both the public resize and upstream's own observers. New models own new instances.
    const cubism2 = core._state?.l2d2Model;
    if (cubism2?.resize) {
      const resize = cubism2.resize.bind(cubism2);
      cubism2.resize = () => {
        resize();
        requestStill();
      };
    }
    for (const delegate of core._state?.l2d6Model?._subdelegates ?? []) {
      if (!delegate.resizeCanvas) continue;
      const resize = delegate.resizeCanvas.bind(delegate);
      delegate.resizeCanvas = () => {
        resize();
        requestStill();
      };
    }
  };
  core.pauseRendering = () => {
    if (renderingPaused) return;
    renderingPaused = true;
    const cubism2 = core._state?.l2d2Model;
    if (cubism2?._drawFrameId != null) cancelAnimationFrame(cubism2._drawFrameId);
    if (cubism2) {
      cubism2._drawFrameId = null;
      cubism2.isDrawStart = false;
    }
    core._state?.l2d6Model?.stop?.();
  };
  core.resumeRendering = () => {
    if (!renderingPaused) return;
    renderingPaused = false;
    core._state?.l2d2Model?.startDraw?.();
    core._state?.l2d6Model?.run?.();
  };
  const getCubism6Model = () => core._state?.l2d6Model?._subdelegates?.[0]?.getLive2DManager?.()?._models?.[0];
  // l2d 将 undefined 表情解释成“随机表情”，且没有公开默认态 API。停止当前
  // manager 后，模型自己的更新循环会在下一帧恢复 idle 动作和未叠加表情的参数。
  // 这里集中隔离锁定版 l2d 2.1.1 的内部字段，避免 UI 通过重载模型来重置状态。
  core.resetMotion = () => {
    core._state?.l2d2Model?.live2DMgr?.getModel?.()?.mainMotionManager?.stopAllMotions?.();
    getCubism6Model()?._motionManager?.stopAllMotions?.();
  };
  core.resetExpression = () => {
    core._state?.l2d2Model?.live2DMgr?.getModel?.()?.expressionManager?.stopAllMotions?.();
    getCubism6Model()?._expressionManager?.stopAllMotions?.();
  };
  return core;
}
