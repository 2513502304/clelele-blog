import type { L2D, ResourceRequestHook } from 'l2d';

export type Live2DRendererPhase = 'dormant' | 'loading' | 'ready' | 'recoverable' | 'destroyed';

export interface Live2DRendererSelection {
  key: string;
  entryPath: string;
  scale: number;
  position: [number, number];
}

export interface Live2DCore {
  load(options: {
    path: string;
    scale?: number;
    position?: [number, number];
    volume?: number;
    request?: ResourceRequestHook;
    signal?: AbortSignal;
    ownsInput?: (event: Event) => boolean;
  }): Promise<void>;
  resize(): void;
  suspend(): void;
  resume(): void;
  destroy(): void;
  playMotion(group: string, index?: number, priority?: number): void;
  setExpression(id?: string): void;
  on(event: 'tap', listener: (areaName: string) => void): Live2DCore;
}

export interface Live2DRendererOptions {
  canvas: HTMLCanvasElement;
  request: ResourceRequestHook;
  prepare?: (signal: AbortSignal) => Promise<void>;
  ownsInput: (event: Event) => boolean;
  createCore?: (canvas: HTMLCanvasElement) => Promise<Live2DCore>;
  timeoutMs?: number;
  onPhase?: (phase: Live2DRendererPhase, error?: unknown) => void;
  onTap?: (areaName: string) => void;
}

export interface Live2DRendererLoadResources {
  request: ResourceRequestHook;
  prepare?: (signal: AbortSignal) => Promise<void>;
}

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

async function defaultCreateCore(canvas: HTMLCanvasElement): Promise<Live2DCore> {
  const { init } = await import('l2d');
  const core = init(canvas);
  if (!core) throw new Error('Live2D renderer could not initialize the canvas.');
  return core as L2D;
}

/**
 * 串行化所有 `l2d` 变更，并用 generation 隔离超时、切换与销毁后的迟到结果。
 * Cubism 2 仍有全局运行时状态，因此即使浏览器有余量也不能并发执行模型 mutation。
 */
export class Live2DRenderer {
  private readonly options: Required<Pick<Live2DRendererOptions, 'timeoutMs'>> & Live2DRendererOptions;
  private core: Live2DCore | null = null;
  private phase: Live2DRendererPhase = 'dormant';
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();
  private activeController: AbortController | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeFrame: number | null = null;
  private destroyed = false;
  private suspended = false;
  private contextLost = false;
  private lastSelection: Live2DRendererSelection | null = null;
  private lastResources: Live2DRendererLoadResources | undefined;

  constructor(options: Live2DRendererOptions) {
    this.options = { ...options, timeoutMs: options.timeoutMs ?? 30_000 };
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
    // 动态导入/构造可能在 island 已销毁或 WebGL 丢失后才返回，此时必须就地释放迟到 core。
    if (this.destroyed || this.contextLost) {
      core.destroy();
      throw abortError('Live2D core creation completed outside an active WebGL generation.');
    }
    core.on('tap', (areaName) => this.options.onTap?.(areaName));
    this.core = core;
    return core;
  }

  /** 最新选择会取消当前网络代际，并在前一 mutation 确实结算后启动。 */
  load(selection: Live2DRendererSelection, resources?: Live2DRendererLoadResources): Promise<void> {
    if (this.destroyed) return Promise.reject(abortError('Live2D renderer is destroyed.'));
    this.lastSelection = selection;
    this.lastResources = resources;
    if (this.contextLost) return Promise.reject(abortError('Live2D WebGL context is currently lost.'));
    const generation = ++this.generation;
    this.activeController?.abort();
    const run = async (): Promise<void> => {
      if (this.destroyed || generation !== this.generation) throw abortError('Live2D selection was superseded.');
      const controller = new AbortController();
      this.activeController = controller;
      this.setPhase('loading');
      const timeout = setTimeout(() => controller.abort(abortError('Live2D model load timed out.')), this.options.timeoutMs);
      try {
        await (resources?.prepare ?? this.options.prepare)?.(controller.signal);
        const core = await this.ensureCore();
        await core.load({
          path: selection.entryPath,
          scale: selection.scale,
          position: selection.position,
          volume: 0,
          request: resources?.request ?? this.options.request,
          signal: controller.signal,
          ownsInput: this.options.ownsInput,
        });
        if (this.destroyed || generation !== this.generation || controller.signal.aborted) {
          throw controller.signal.reason ?? abortError('Live2D load result is stale.');
        }
        if (this.suspended) core.suspend();
        this.setPhase('ready');
      } catch (error) {
        if (!this.destroyed && generation === this.generation) this.setPhase('recoverable', error);
        throw error;
      } finally {
        clearTimeout(timeout);
        if (this.activeController === controller) this.activeController = null;
      }
    };
    const result = this.tail.catch(() => undefined).then(run);
    this.tail = result.catch(() => undefined);
    return result;
  }

  playMotion(group: string, index?: number): void {
    if (this.phase === 'ready') this.core?.playMotion(group, index);
  }

  setExpression(id?: string): void {
    if (this.phase === 'ready') this.core?.setExpression(id);
  }

  /** 暂停动画帧，但保留已加载模型和不可变资源缓存。 */
  suspend(): void {
    this.suspended = true;
    this.core?.suspend();
  }

  /** 恢复暂停的 renderer；底层补丁保证重复恢复不会创建多个动画循环。 */
  resume(): void {
    this.suspended = false;
    if (this.phase === 'ready') this.core?.resume();
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.destroyed || this.contextLost) return;
    this.contextLost = true;
    this.generation += 1;
    this.activeController?.abort(abortError('Live2D WebGL context was lost.'));
    this.activeController = null;
    this.core?.destroy();
    this.core = null;
    this.setPhase('recoverable', new Error('Live2D WebGL context was lost.'));
  };

  private readonly handleContextRestored = (): void => {
    if (this.destroyed || !this.contextLost) return;
    this.contextLost = false;
    if (this.lastSelection) void this.load(this.lastSelection, this.lastResources).catch(() => undefined);
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

  /** 可从任意生命周期状态重复调用；后续迟到结果均被 generation 丢弃。 */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    this.activeController?.abort(abortError('Live2D renderer was destroyed.'));
    this.activeController = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeFrame !== null) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = null;
    this.options.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.options.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.core?.destroy();
    this.core = null;
    this.setPhase('destroyed');
  }
}
