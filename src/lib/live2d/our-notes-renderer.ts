import { type NativeRuntime, type NativeSession, nativeParameters } from './our-notes-runtime-types';
import type { Live2DCore } from './renderer';
import { clampParameterOverrides } from './studio-state';

const VENDOR = '/vendor/ournotes-player-0.1.1';
let runtime: Promise<NativeRuntime> | undefined;
let coreScript: Promise<void> | undefined;

async function loadRuntime(): Promise<NativeRuntime> {
  coreScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${VENDOR}/live2dcubismcore.min.js`;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error('Our Notes Cubism Core could not load.'));
    };
    document.head.append(script);
  }).catch((error) => {
    coreScript = undefined;
    throw error;
  });
  await coreScript;
  const url = new URL(`${VENDOR}/ournotes-player.live2d.min.js`, window.location.origin).href;
  // Load the unmodified browser artifact under its embedding exception; never bundle its source.
  runtime ??= import(/* @vite-ignore */ url).catch((error) => {
    runtime = undefined;
    throw error;
  });
  return runtime as Promise<NativeRuntime>;
}

/** One native game session, with a bounded 30 fps clock and no animation loop while paused. */
export function createOurNotesCore(canvas: HTMLCanvasElement): Live2DCore {
  let session: NativeSession | null = null;
  let controller = new AbortController();
  let frame: number | null = null;
  let paused = false;
  let destroyed = false;
  let lastFrame = 0;
  let loopGeneration = 0;
  let loading = false;
  let pointer: { x: number; y: number } | null = null;
  let pendingStep: Promise<void> | null = null;
  let overrides: Record<string, number> = {};
  let tracking = true;
  const listeners = new Map<string, Array<(value?: string) => void>>();
  const stop = () => {
    loopGeneration++;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
  const tick = async (now: number) => {
    frame = null;
    if (paused || destroyed || loading || !session) return;
    const generation = loopGeneration;
    if (now - lastFrame >= 1000 / 30) {
      // Keep the fractional remainder: resetting to now undershoots 30 fps on 60 Hz displays.
      lastFrame = now - ((now - lastFrame) % (1000 / 30));
      if (tracking && pointer) {
        const r = canvas.getBoundingClientRect();
        if (r.width && r.height) {
          session.character.setLookX(Math.max(-1, Math.min(1, ((pointer.x - r.left) / r.width) * 2 - 1)));
          session.character.setLookY(Math.max(-1, Math.min(1, 1 - ((pointer.y - r.top) / r.height) * 2)));
        }
        pointer = null;
      }
      pendingStep = session.step();
      try {
        await pendingStep;
      } catch (error) {
        paused = true;
        console.warn('[Live2D] Native frame failed.', error);
      } finally {
        pendingStep = null;
      }
    }
    if (generation === loopGeneration && !paused && !destroyed && !loading && session) frame = requestAnimationFrame(tick);
  };
  const start = () => {
    if (frame === null && !pendingStep && !paused && !destroyed && !loading && session) {
      lastFrame = performance.now();
      frame = requestAnimationFrame(tick);
    }
  };
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    if (rect.width && rect.height)
      session?.resize(Math.round(canvas.clientWidth * ratio), Math.round(canvas.clientHeight * ratio));
    if (paused && !pendingStep) session?.render();
  };
  const move = (event: PointerEvent) => {
    if (!tracking || paused || !session) return;
    pointer = { x: event.clientX, y: event.clientY };
  };
  document.addEventListener('pointermove', move, { passive: true });
  const release = async () => {
    stop();
    controller.abort();
    await pendingStep?.catch(() => undefined);
    const previous = session;
    session = null;
    await previous?.dispose();
  };
  const core: Live2DCore = {
    async load({ path }) {
      loading = true;
      await release();
      controller = new AbortController();
      const signal = controller.signal;
      const lib = await loadRuntime();
      signal.throwIfAborted();
      const url = new URL(path, window.location.href);
      const assets = await lib.AssetStore.fromManifest(url.href, { signal, base: new URL('./', url).href, concurrency: 4 });
      signal.throwIfAborted();
      const gl = canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
      });
      if (!gl) throw new Error('Our Notes requires WebGL2.');
      const loaded = await lib.ModelSession.create({ gl, assets, width: canvas.clientWidth, height: canvas.clientHeight });
      if (signal.aborted || destroyed) {
        await loaded.dispose();
        signal.throwIfAborted();
        throw new Error('Native session disposed.');
      }
      session = loaded;
      overrides = {};
      // The pinned runtime finishes animation/physics before modelUpdate. Apply overrides there once
      // per frame, so motion cannot erase an edited face and we do not need a second animation loop.
      const originalUpdate = loaded.character.modelUpdate.bind(loaded.character);
      const indices = new Map(loaded.character.core.parameters.ids.map((id, i) => [id, i]));
      loaded.character.modelUpdate = () => {
        for (const [id, value] of Object.entries(overrides)) {
          const index = indices.get(id);
          if (index !== undefined) loaded.character.params.value[index] = value;
        }
        originalUpdate();
      };
      loaded.character.setLookEnabled(tracking);
      resize();
      loaded.render();
      for (const listener of listeners.get('loaded') ?? []) listener();
      loading = false;
      start();
    },
    resize,
    async destroy() {
      destroyed = true;
      document.removeEventListener('pointermove', move);
      await release();
    },
    getParams: () => (session ? nativeParameters(session) : []),
    setParams(values) {
      if (!session) return;
      overrides = clampParameterOverrides(values, nativeParameters(session));
      // One requested frame makes paused editing visible; never restart the continuous clock.
      if (paused && !pendingStep) {
        pendingStep = session.step();
        void pendingStep
          .catch((error) => console.warn('[Live2D] Pose update failed.', error))
          .finally(() => {
            pendingStep = null;
          });
      }
    },
    // Native motions are in the prefab. Empty paths prevent treating their names as prefetch URLs.
    getMotions: () => Object.fromEntries((session?.motions ?? []).map((name) => [name, ['']])),
    getExpressions: () => session?.expressions ?? [],
    playMotion(group) {
      session?.playMotion(group);
    },
    resetMotion() {
      if (session?.defaultMotion) session.playMotion(session.defaultMotion);
    },
    setExpression(id) {
      session?.setExpression(id);
    },
    resetExpression() {
      if (session?.defaultExpression) session.setExpression(session.defaultExpression);
    },
    setEffects(effects) {
      session?.setPhysics(effects.sway);
      session?.setBreath(effects.breathe);
      session?.character.setEyeBlinkEnabled(effects.blink);
    },
    setPointerTracking(enabled) {
      tracking = enabled;
      session?.character.setLookEnabled(enabled);
    },
    pauseRendering() {
      paused = true;
      stop();
    },
    resumeRendering() {
      paused = false;
      if (pendingStep) void pendingStep.catch(() => undefined).then(start);
      else start();
    },
    captureFrame() {
      if (!session) return null;
      session.render();
      return canvas.toDataURL('image/png');
    },
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return core;
    },
  };
  return core;
}
