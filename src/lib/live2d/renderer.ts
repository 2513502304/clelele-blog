import { createLive2DCore } from './create-core';
import { clampParameterOverrides, type Live2DParameter } from './studio-state';

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
  destroy(): void | Promise<void>;
  getParams(): unknown[];
  setParams?(params: Record<string, number>): void;
  captureFrame?(): string | null;
  getMotions(): Record<string, string[]>;
  getExpressions(): string[];
  playMotion(group: string, index?: number, priority?: number): void;
  setExpression(id: string): void;
  setPointerTracking?(enabled: boolean): void;
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
  loadTimeoutMs?: number;
  prefetchMotion?: (url: string, signal: AbortSignal) => Promise<void>;
  motionPrefetchConcurrency?: number;
  onPhase?: (phase: Live2DRendererPhase, error?: unknown) => void;
  onTap?: (areaName: string) => void;
}

const DEFAULT_MOTION_PREFETCH_CONCURRENCY = 4;
const MAX_MOTION_PREFETCH_CONCURRENCY = 8;
const MOTION_PREFETCH_IDLE_TIMEOUT_MS = 2_000;
// l2d 2.1.1 在 Cubism 包内部资源请求失败时不会 reject。限制整包加载时间，
// 让访客最终能看到重试入口，而不是一直停留在加载状态。
const DEFAULT_MODEL_LOAD_TIMEOUT_MS = 45_000;

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

function loadTimeoutError(path: string): DOMException {
  return new DOMException(`Live2D model load timed out: ${path}`, 'TimeoutError');
}

async function withLoadDeadline(load: Promise<void>, timeoutMs: number, path: string): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      load,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(loadTimeoutError(path)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
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
  private readonly loadedEvents = new WeakMap<Live2DCore, { count: number }>();
  private tail: Promise<void> = Promise.resolve();
  private resizeObserver: ResizeObserver | null = null;
  private resizeFrame: number | null = null;
  private destroyed = false;
  private suspended = false;
  private playbackPaused = false;
  private pendingMotion: Parameters<Live2DCore['playMotion']> | 'reset' | null = null;
  private contextLost = false;
  private lastSelection: Live2DRendererSelection | null = null;
  private readonly warmedMotions = new Set<string>();
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
    const core = this.options.createCore
      ? await this.options.createCore(this.options.canvas)
      : await createLive2DCore(this.options.canvas, this.lastSelection?.entryPath.endsWith('.native.json') ?? false);
    if (this.destroyed || this.contextLost) {
      await core.destroy();
      throw abortError('Live2D core creation completed outside an active WebGL generation.');
    }
    core.on('tap', (areaName) => this.options.onTap?.(areaName ?? ''));
    core.on('loaded', () => {
      const events = this.loadedEvents.get(core);
      if (events) events.count += 1;
    });
    this.loadedEvents.set(core, { count: 0 });
    this.core = core;
    return core;
  }

  /** Keeps only the latest queued selection while allowing the current upstream load to settle. */
  load(selection: Live2DRendererSelection): Promise<void> {
    if (this.destroyed) return Promise.reject(abortError('Live2D renderer is destroyed.'));
    this.cancelMotionPrefetch();
    this.warmedMotions.clear();
    this.pendingMotion = null;
    this.lastSelection = selection;
    if (this.contextLost) return Promise.reject(abortError('Live2D WebGL context is currently lost.'));
    const generation = ++this.generation;
    const run = async (): Promise<void> => {
      if (this.destroyed || this.suspended || generation !== this.generation) {
        throw abortError('Live2D selection was superseded.');
      }
      this.setPhase('loading');
      let core: Live2DCore | null = null;
      try {
        core = await this.ensureCore();
        const events = this.loadedEvents.get(core);
        const loadedBefore = events?.count ?? 0;
        await withLoadDeadline(
          core.load({
            path: selection.entryPath,
            scale: selection.scale,
            position: selection.position,
            volume: 0,
            logLevel: 'warn',
          }),
          this.options.loadTimeoutMs ?? DEFAULT_MODEL_LOAD_TIMEOUT_MS,
          selection.entryPath,
        );
        if (this.destroyed || this.suspended || generation !== this.generation) {
          throw abortError('Live2D load result is stale.');
        }
        // Upstream logs and returns for fetch/initialization failures instead of rejecting.
        // Requiring its success event prevents a transparent or partial canvas being reported ready.
        if ((events?.count ?? 0) === loadedBefore || core.getParams().length === 0) {
          throw new Error(`Live2D model did not finish loading: ${selection.entryPath}`);
        }
        if (this.playbackPaused) core.pauseRendering?.();
        this.setPhase('ready');
        this.scheduleMotionPrefetch(core, selection, generation);
      } catch (error) {
        // 失败或超时的 l2d core 可能保留部分纹理和未完成回调。展示重试入口前先销毁，
        // 确保下一代加载从干净实例开始，也避免旧 loaded 事件污染新模型状态。
        if (core && this.core === core) {
          await this.disposeCore();
        }
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
    if (this.playbackPaused) return;
    const urls = [
      ...new Set(
        Object.values(core.getMotions())
          .flat()
          .filter(Boolean)
          .map((motionPath) => resolveMotionUrl(selection.entryPath, motionPath)),
      ),
    ];
    const pending = urls.filter((url) => !this.warmedMotions.has(url));
    if (pending.length === 0) return;

    this.cancelScheduledMotionPrefetch = scheduleIdleTask(() => {
      this.cancelScheduledMotionPrefetch = null;
      if (!this.destroyed && !this.suspended && !this.playbackPaused && generation === this.generation) {
        this.startMotionPrefetch(pending, generation);
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
          if (!controller.signal.aborted && generation === this.generation) this.warmedMotions.add(url);
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
    if (this.phase !== 'ready') return;
    if (this.playbackPaused) this.pendingMotion = [group, index, priority];
    else this.core?.playMotion(group, index, priority);
  }

  resetMotion(): void {
    if (this.phase !== 'ready') return;
    if (this.playbackPaused) this.pendingMotion = 'reset';
    else this.core?.resetMotion?.();
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

  /** Disables upstream document tracking while a Live2D control panel owns pointer focus. */
  setPointerTracking(enabled: boolean): void {
    if (this.phase === 'ready') this.core?.setPointerTracking?.(enabled);
  }

  getMotions(): Record<string, string[]> {
    return this.phase === 'ready' ? (this.core?.getMotions() ?? {}) : {};
  }

  getExpressions(): string[] {
    return this.phase === 'ready' ? (this.core?.getExpressions() ?? []) : [];
  }

  getParameters(): Live2DParameter[] {
    if (this.phase !== 'ready') return [];
    return (this.core?.getParams() ?? []).filter((p): p is Live2DParameter => {
      const v = p as Live2DParameter | null;
      return !!v && typeof v.id === 'string' && [v.value, v.min, v.max, v.default].every(Number.isFinite) && v.min <= v.max;
    });
  }

  setParameters(values: Record<string, number>): void {
    if (this.phase === 'ready') this.core?.setParams?.(clampParameterOverrides(values, this.getParameters()));
  }

  /** Freezes the current model instance; unlike suspend(), this preserves animation and expression state. */
  setPlaybackPaused(paused: boolean): void {
    if (this.playbackPaused === paused) return;
    this.playbackPaused = paused;
    if (this.phase !== 'ready') return;
    if (paused) {
      this.cancelMotionPrefetch();
      this.core?.pauseRendering?.();
    } else {
      this.core?.resumeRendering?.();
      // Controls remain reachable above some dialogs. Defer only the latest intent without
      // fetching motions or waking the hidden canvas, and discard it when switching models.
      const pending = this.pendingMotion;
      this.pendingMotion = null;
      if (pending === 'reset') this.core?.resetMotion?.();
      else if (pending) this.core?.playMotion(...pending);
      if (this.core && this.lastSelection) this.scheduleMotionPrefetch(this.core, this.lastSelection, this.generation);
    }
  }

  /** Captures the transparent canvas before pause or user download without another network read. */
  captureFrame(): string | null {
    if (this.phase !== 'ready' || typeof this.options.canvas.toDataURL !== 'function') return null;
    try {
      if (this.core?.captureFrame) return this.core.captureFrame();
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
      .then(async () => {
        if (this.suspended && !this.destroyed) {
          await this.disposeCore();
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
    const disposal = Promise.resolve(this.core?.destroy()).catch((error) => {
      console.warn('[Live2D] Context loss cleanup failed.', error);
    });
    this.core = null;
    // Native disposal waits for an in-flight frame. Restoration must not reuse its GL context early.
    this.tail = this.tail.catch(() => undefined).then(() => disposal);
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

  /** Detach first: rejected async native disposal must not leave a destroyed instance reusable. */
  private async disposeCore(): Promise<void> {
    const core = this.core;
    this.core = null;
    try {
      await core?.destroy();
    } catch (error) {
      console.warn('[Live2D] Core cleanup failed.', error);
    }
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
      .then(async () => {
        await this.disposeCore();
      });
  }
}
