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
  setExpression(id?: string): void;
  pauseRendering?(): void;
  resumeRendering?(): void;
  on(event: Live2DCoreEvent, listener: (value?: string) => void): Live2DCore;
}

export interface Live2DRendererOptions {
  canvas: HTMLCanvasElement;
  createCore?: (canvas: HTMLCanvasElement) => Promise<Live2DCore>;
  onPhase?: (phase: Live2DRendererPhase, error?: unknown) => void;
  onTap?: (areaName: string) => void;
}

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
          } | null;
          l2d6Model?: { stop?: () => void; run?: () => void } | null;
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
  return core;
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
    this.options.onPhase?.(phase, error);
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

  playMotion(group: string, index?: number, priority?: number): void {
    if (this.phase === 'ready' && !this.playbackPaused) this.core?.playMotion(group, index, priority);
  }

  setExpression(id?: string): void {
    if (this.phase === 'ready') this.core?.setExpression(id);
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

  /** Releases model resources while hidden; resume reloads the latest immutable package from cache. */
  suspend(): void {
    if (this.suspended || this.destroyed) return;
    this.suspended = true;
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
