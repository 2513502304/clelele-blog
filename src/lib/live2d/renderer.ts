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
  destroy(): void;
  playMotion(group: string, index?: number, priority?: number): void;
  setExpression(id?: string): void;
  on(event: 'tap', listener: (areaName: string) => void): Live2DCore;
}

export interface Live2DRendererOptions {
  canvas: HTMLCanvasElement;
  request: ResourceRequestHook;
  ownsInput: (event: Event) => boolean;
  createCore?: (canvas: HTMLCanvasElement) => Promise<Live2DCore>;
  timeoutMs?: number;
  onPhase?: (phase: Live2DRendererPhase, error?: unknown) => void;
  onTap?: (areaName: string) => void;
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

  constructor(options: Live2DRendererOptions) {
    this.options = { ...options, timeoutMs: options.timeoutMs ?? 30_000 };
    this.installResizeObserver();
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
    core.on('tap', (areaName) => this.options.onTap?.(areaName));
    this.core = core;
    return core;
  }

  /** 最新选择会取消当前网络代际，并在前一 mutation 确实结算后启动。 */
  load(selection: Live2DRendererSelection): Promise<void> {
    if (this.destroyed) return Promise.reject(abortError('Live2D renderer is destroyed.'));
    const generation = ++this.generation;
    this.activeController?.abort();
    const run = async (): Promise<void> => {
      if (this.destroyed || generation !== this.generation) throw abortError('Live2D selection was superseded.');
      const controller = new AbortController();
      this.activeController = controller;
      this.setPhase('loading');
      const timeout = setTimeout(() => controller.abort(abortError('Live2D model load timed out.')), this.options.timeoutMs);
      try {
        const core = await this.ensureCore();
        await core.load({
          path: selection.entryPath,
          scale: selection.scale,
          position: selection.position,
          volume: 0,
          request: this.options.request,
          signal: controller.signal,
          ownsInput: this.options.ownsInput,
        });
        if (this.destroyed || generation !== this.generation || controller.signal.aborted) {
          throw controller.signal.reason ?? abortError('Live2D load result is stale.');
        }
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
    this.core?.destroy();
    this.core = null;
    this.setPhase('destroyed');
  }
}
