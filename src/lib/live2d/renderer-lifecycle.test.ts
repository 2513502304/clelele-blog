import assert from 'node:assert/strict';
import test from 'node:test';
import { type Live2DCore, Live2DRenderer } from './renderer';

function createCore(overrides: Partial<Live2DCore> = {}): Live2DCore {
  const listeners = new Map<'tap' | 'loaded', Array<(value?: string) => void>>();
  return {
    async load() {
      for (const listener of listeners.get('loaded') ?? []) listener();
    },
    resize() {},
    destroy() {},
    getParams() {
      return [{}];
    },
    getMotions() {
      return {};
    },
    getExpressions() {
      return [];
    },
    playMotion() {},
    setExpression() {},
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return this;
    },
    ...overrides,
  };
}

test('destroy is idempotent during an active load and suppresses late readiness', async () => {
  let destroyCount = 0;
  let resolveLoad: (() => void) | undefined;
  const phases: string[] = [];
  const core = createCore({
    load: () =>
      new Promise<void>((resolve) => {
        resolveLoad = resolve;
      }),
    destroy: () => {
      destroyCount += 1;
    },
  });
  const renderer = new Live2DRenderer({
    canvas: new EventTarget() as HTMLCanvasElement,
    createCore: async () => core,
    onPhase: (phase) => phases.push(phase),
  });
  const loading = renderer.load({ key: 'one', entryPath: '/one/model.json', scale: 1, position: [0, 0] });
  await new Promise((resolve) => setImmediate(resolve));
  renderer.destroy();
  renderer.destroy();
  resolveLoad?.();
  await assert.rejects(loading, { name: 'AbortError' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(destroyCount, 1);
  assert.equal(renderer.getPhase(), 'destroyed');
  assert.equal(phases.includes('ready'), false);
});

test('destroys a core that finishes construction after final teardown', async () => {
  let resolveCore: ((core: Live2DCore) => void) | undefined;
  let destroyCount = 0;
  const core = createCore({
    destroy: () => {
      destroyCount += 1;
    },
  });
  const renderer = new Live2DRenderer({
    canvas: new EventTarget() as HTMLCanvasElement,
    createCore: () =>
      new Promise((resolve) => {
        resolveCore = resolve;
      }),
  });
  const loading = renderer.load({ key: 'late', entryPath: '/late/model.json', scale: 1, position: [0, 0] });
  await new Promise((resolve) => setImmediate(resolve));
  renderer.destroy();
  resolveCore?.(core);
  await assert.rejects(loading, { name: 'AbortError' });
  assert.equal(destroyCount, 1);
});

test('reloads the latest selection after WebGL context restoration', async () => {
  const canvas = new EventTarget() as HTMLCanvasElement;
  const loadedPaths: string[] = [];
  let createCount = 0;
  let destroyCount = 0;
  const renderer = new Live2DRenderer({
    canvas,
    createCore: async () => {
      createCount += 1;
      const core = createCore({
        async load({ path }) {
          loadedPaths.push(path);
          // The helper's loaded listener is private, so expose one successful parameter after load.
        },
        destroy() {
          destroyCount += 1;
        },
      });
      // Override `on` so each load emits success through the registered callback.
      const listeners = new Map<'tap' | 'loaded', Array<(value?: string) => void>>();
      core.on = (event, listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return core;
      };
      core.load = async ({ path }) => {
        loadedPaths.push(path);
        for (const listener of listeners.get('loaded') ?? []) listener();
      };
      return core;
    },
  });
  await renderer.load({ key: 'restored', entryPath: '/restored/model.json', scale: 1, position: [0, 0] });
  const lost = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(lost);
  assert.equal(lost.defaultPrevented, true);
  assert.equal(renderer.getPhase(), 'recoverable');
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renderer.getPhase(), 'ready');
  assert.deepEqual(loadedPaths, ['/restored/model.json', '/restored/model.json']);
  assert.equal(createCount, 2);
  assert.equal(destroyCount, 1);
  renderer.destroy();
});
