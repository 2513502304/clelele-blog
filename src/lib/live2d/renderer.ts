export type Live2DRendererPhase = 'dormant' | 'loading' | 'ready' | 'recoverable' | 'destroyed';

export interface Live2DRendererSelection {
  key: string;
  entryPath: string;
  scale: number;
  position: [number, number];
}

type Live2DCoreEvent = 'tap' | 'loaded';

export interface Live2DCore {
  load(options: {
    path: string;
    scale?: number;
    position?: [number, number];
    volume?: number;
    logLevel?: 'error' | 'warn' | 'info' | 'trace';
  }): Promise<void>;
  resize(): void;
  destroy(): void;
  getParams(): unknown[];
  getMotions(): Record<string, string[]>;
  getExpressions(): string[];
  playMotion(group: string, index?: number, priority?: number): void;
  setExpression(id: string): void;
  resetMotion?(): void;
  resetExpression?(): void;
  setEffects?(effects: { sway: boolean; breathe: boolean; blink: boolean }): void;
  pauseRendering?(): void;
  resumeRendering?(): void;
  on(event: Live2DCoreEvent, listener: (value?: string) => void): Live2DCore;
}

export interface Live2DRendererOptions {
  canvas: HTMLCanvasElement;
  createCore?: (canvas: HTMLCanvasElement) => Promise<Live2DCore>;
  prefetchMotion?: (url: string, signal: AbortSignal) => Promise<void>;
  motionPrefetchConcurrency?: number;
  onPhase?: (phase: Live2DRendererPhase, error?: unknown) => void;
  onTap?: (areaName: string) => void;
}

const DEFAULT_MOTION_PREFETCH_CONCURRENCY = 4;
const MAX_MOTION_PREFETCH_CONCURRENCY = 8;
const MOTION_PREFETCH_IDLE_TIMEOUT_MS = 2_000;

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

async function defaultCreateCore(canvas: HTMLCanvasElement): Promise<Live2DCore> {
  const { init } = await import('l2d');
  const core = init(canvas) as unknown as
    | (Live2DCore & {
        _state?: {
          l2d2Model?: {
            _drawFrameId?: number | null;
            isDrawStart?: boolean;
            startDraw?: () => void;
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
            _subdelegates?: Array<{
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

/**
 * 完整消费不可变动作响应，让 l2d 后续解析动作时复用浏览器有容量上限的 HTTP 缓存。
 * 应用状态不保留响应字节，避免切换多个角色后在 JS 堆中累积模型资源。
 */
async function defaultPrefetchMotion(url: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(url, {
    cache: 'force-cache',
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) throw new Error(`Live2D motion prefetch failed: ${response.status} (${url})`);
  if (!response.body) {
    await response.arrayBuffer();
    return;
  }
  const reader = response.body.getReader();
  try {
    while (!(await reader.read()).done) {
      // 流式读完响应即可填充 HTTP 缓存，不额外拼接完整 ArrayBuffer。
    }
  } finally {
    reader.releaseLock();
  }
}

function resolveMotionUrl(entryPath: string, motionPath: string): string {
  const baseHref = typeof location === 'undefined' ? 'http://localhost/' : location.href;
  return new URL(motionPath, new URL(entryPath, baseHref)).href;
}

function scheduleIdleTask(task: () => void): () => void {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    const handle = window.requestIdleCallback(task, { timeout: MOTION_PREFETCH_IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = setTimeout(task, 0);
  return () => clearTimeout(handle);
}

/**
 * Serializes model mutations around the unmodified upstream renderer.
 *
 * `l2d` owns Cubism's global runtime and cannot cancel a load in progress. A generation
 * therefore discards superseded results, while the queue ensures a newer model never mutates
 * the same WebGL state concurrently. Network deadlines remain in the same-origin asset route,
 * where they can actually abort the origin request.
 */
export class Live2DRenderer {
  private readonly options: Live2DRendererOptions;
  private core: Live2DCore | null = null;
  private phase: Live2DRendererPhase = 'dormant';
  private generation = 0;
  private loadedEvents = 0;
  private tail: Promise<void> = Promise.resolve();
  private resizeObserver: ResizeObserver | null = null;
  private resizeFrame: number | null = null;
  private destroyed = false;
  private suspended = false;
  private playbackPaused = false;
  private contextLost = false;
  private lastSelection: Live2DRendererSelection | null = null;
  private motionPrefetchController: AbortController | null = null;
  private cancelScheduledMotionPrefetch: (() => void) | null = null;

  constructor(options: Live2DRendererOptions) {
    this.options = options;
    this.installResizeObserver();
    this.options.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.options.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  getPhase(): Live2DRendererPhase {
    return this.phase;
  }

  private setPhase(phase: Live2DRendererPhase, error?: unknown): void {
    this.phase = phase;
    try {
      this.options.onPhase?.(phase, error);
    } catch (callbackError) {
      // UI observers are outside the rendering state machine. Their failures must not turn a
      // successfully loaded model into a recoverable renderer failure.
      console.error('[Live2D] Renderer phase observer failed.', callbackError);
    }
  }

  private async ensureCore(): Promise<Live2DCore> {
    if (this.core) return this.core;
    const core = await (this.options.createCore ?? defaultCreateCore)(this.options.canvas);
    if (this.destroyed || this.contextLost) {
      core.destroy();
      throw abortError('Live2D core creation completed outside an active WebGL generation.');
    }
    core.on('tap', (areaName) => this.options.onTap?.(areaName ?? ''));
    core.on('loaded', () => {
      this.loadedEvents += 1;
    });
    this.core = core;
    return core;
  }

  /** Keeps only the latest queued selection while allowing the current upstream load to settle. */
  load(selection: Live2DRendererSelection): Promise<void> {
    if (this.destroyed) return Promise.reject(abortError('Live2D renderer is destroyed.'));
    this.cancelMotionPrefetch();
    this.lastSelection = selection;
    if (this.contextLost) return Promise.reject(abortError('Live2D WebGL context is currently lost.'));
    const generation = ++this.generation;
    const run = async (): Promise<void> => {
      if (this.destroyed || this.suspended || generation !== this.generation) {
        throw abortError('Live2D selection was superseded.');
      }
      this.setPhase('loading');
      try {
        const core = await this.ensureCore();
        const loadedBefore = this.loadedEvents;
        await core.load({
          path: selection.entryPath,
          scale: selection.scale,
          position: selection.position,
          volume: 0,
          logLevel: 'warn',
        });
        if (this.destroyed || this.suspended || generation !== this.generation) {
          throw abortError('Live2D load result is stale.');
        }
        // Upstream logs and returns for fetch/initialization failures instead of rejecting.
        // Requiring its success event prevents a transparent or partial canvas being reported ready.
        if (this.loadedEvents === loadedBefore || core.getParams().length === 0) {
          throw new Error(`Live2D model did not finish loading: ${selection.entryPath}`);
        }
        if (this.playbackPaused) core.pauseRendering?.();
        this.setPhase('ready');
        this.scheduleMotionPrefetch(core, selection, generation);
      } catch (error) {
        if (!this.destroyed && !this.suspended && generation === this.generation) {
          this.setPhase('recoverable', error);
        }
        throw error;
      }
    };
    const result = this.tail.catch(() => undefined).then(run);
    this.tail = result.catch(() => undefined);
    return result;
  }

  /**
   * 首帧完成后只预热当前模型按需加载的动作。基础模型和表情已由 l2d 主动加载，重复请求
   * 不会改善切换延迟，反而会增加流量和 Vercel Function 压力。
   */
  private scheduleMotionPrefetch(core: Live2DCore, selection: Live2DRendererSelection, generation: number): void {
    this.cancelMotionPrefetch();
    const urls = [
      ...new Set(
        Object.values(core.getMotions())
          .flat()
          .filter(Boolean)
          .map((motionPath) => resolveMotionUrl(selection.entryPath, motionPath)),
      ),
    ];
    if (urls.length === 0) return;

    this.cancelScheduledMotionPrefetch = scheduleIdleTask(() => {
      this.cancelScheduledMotionPrefetch = null;
      if (!this.destroyed && !this.suspended && generation === this.generation) {
        this.startMotionPrefetch(urls, generation);
      }
    });
  }

  private startMotionPrefetch(urls: readonly string[], generation: number): void {
    const controller = new AbortController();
    this.motionPrefetchController = controller;
    const concurrency = Math.max(
      1,
      Math.min(
        MAX_MOTION_PREFETCH_CONCURRENCY,
        Math.floor(this.options.motionPrefetchConcurrency ?? DEFAULT_MOTION_PREFETCH_CONCURRENCY),
      ),
    );
    const prefetch = this.options.prefetchMotion ?? defaultPrefetchMotion;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (!controller.signal.aborted && generation === this.generation) {
        const index = cursor++;
        const url = urls[index];
        if (!url) return;
        try {
          await prefetch(url, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) return;
          // 预热是尽力而为；失败的动作仍保留 l2d 原有的按需加载兜底路径。
          if (import.meta.env?.DEV) console.warn('[Live2D] Motion prefetch failed.', error);
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker())).finally(() => {
      if (this.motionPrefetchController === controller) this.motionPrefetchController = null;
    });
  }

  private cancelMotionPrefetch(): void {
    this.cancelScheduledMotionPrefetch?.();
    this.cancelScheduledMotionPrefetch = null;
    this.motionPrefetchController?.abort();
    this.motionPrefetchController = null;
  }

  playMotion(group: string, index?: number, priority?: number): void {
    if (this.phase === 'ready' && !this.playbackPaused) this.core?.playMotion(group, index, priority);
  }

  resetMotion(): void {
    if (this.phase === 'ready' && !this.playbackPaused) this.core?.resetMotion?.();
  }

  setExpression(id: string): void {
    if (this.phase === 'ready') this.core?.setExpression(id);
  }

  resetExpression(): void {
    if (this.phase === 'ready' && !this.playbackPaused) this.core?.resetExpression?.();
  }

  setEffects(effects: { sway: boolean; breathe: boolean; blink: boolean }): void {
    if (this.phase === 'ready') this.core?.setEffects?.(effects);
  }

  getMotions(): Record<string, string[]> {
    return this.phase === 'ready' ? (this.core?.getMotions() ?? {}) : {};
  }

  getExpressions(): string[] {
    return this.phase === 'ready' ? (this.core?.getExpressions() ?? []) : [];
  }

  /** Freezes the current model instance; unlike suspend(), this preserves animation and expression state. */
  setPlaybackPaused(paused: boolean): void {
    if (this.playbackPaused === paused) return;
    this.playbackPaused = paused;
    if (this.phase !== 'ready') return;
    if (paused) this.core?.pauseRendering?.();
    else this.core?.resumeRendering?.();
  }

  /** Captures the transparent canvas before pause or user download without another network read. */
  captureFrame(): string | null {
    if (this.phase !== 'ready' || typeof this.options.canvas.toDataURL !== 'function') return null;
    try {
      return this.options.canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  /**
   * Explicit memory-pressure escape hatch. Normal visibility changes use setPlaybackPaused() so
   * the persistent widget keeps its decoded model and WebGL state across routes and modals.
   */
  suspend(): void {
    if (this.suspended || this.destroyed) return;
    this.suspended = true;
    this.cancelMotionPrefetch();
    this.generation += 1;
    this.setPhase('dormant');
    this.tail = this.tail
      .catch(() => undefined)
      .then(() => {
        if (this.suspended && !this.destroyed) {
          this.core?.destroy();
          this.core = null;
        }
      });
  }

  resume(): void {
    if (!this.suspended || this.destroyed) return;
    this.suspended = false;
    if (this.lastSelection) void this.load(this.lastSelection).catch(() => undefined);
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.destroyed || this.contextLost) return;
    this.contextLost = true;
    this.cancelMotionPrefetch();
    this.generation += 1;
    this.core?.destroy();
    this.core = null;
    this.setPhase('recoverable', new Error('Live2D WebGL context was lost.'));
  };

  private readonly handleContextRestored = (): void => {
    if (this.destroyed || !this.contextLost) return;
    this.contextLost = false;
    if (this.lastSelection && !this.suspended) void this.load(this.lastSelection).catch(() => undefined);
  };

  private installResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width <= 0 || box.height <= 0 || this.resizeFrame !== null) return;
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = null;
        if (!this.destroyed) this.core?.resize();
      });
    });
    this.resizeObserver.observe(this.options.canvas);
  }

  /** Marks teardown immediately and queues WebGL cleanup after any in-flight upstream mutation. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelMotionPrefetch();
    this.generation += 1;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeFrame !== null) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = null;
    this.options.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.options.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.setPhase('destroyed');
    this.tail = this.tail
      .catch(() => undefined)
      .then(() => {
        this.core?.destroy();
        this.core = null;
      });
  }
}
