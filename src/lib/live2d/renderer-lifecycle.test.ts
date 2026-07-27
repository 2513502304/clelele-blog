import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResourceRequestHook } from 'l2d';
import { type Live2DCore, Live2DRenderer } from './renderer';

const request = (async () => new Response()) as ResourceRequestHook;

test('destroy is idempotent during an active load and suppresses late readiness', async () => {
  let destroyCount = 0;
  let resolveLoad: (() => void) | undefined;
  const phases: string[] = [];
  const core: Live2DCore = {
    load: ({ signal }) =>
      new Promise<void>((resolve, reject) => {
        resolveLoad = resolve;
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    resize() {},
    suspend() {},
    resume() {},
    destroy() {
      destroyCount += 1;
    },
    playMotion() {},
    setExpression() {},
    on() {
      return this;
    },
  };
  const renderer = new Live2DRenderer({
    canvas: new EventTarget() as HTMLCanvasElement,
    request,
    ownsInput: () => true,
    createCore: async () => core,
    onPhase: (phase) => phases.push(phase),
  });
  const loading = renderer.load({ key: 'one', entryPath: '/one/model.json', scale: 1, position: [0, 0] });
  await new Promise((resolve) => setImmediate(resolve));
  renderer.destroy();
  renderer.destroy();
  resolveLoad?.();
  await assert.rejects(loading, { name: 'AbortError' });
  assert.equal(destroyCount, 1);
  assert.equal(renderer.getPhase(), 'destroyed');
  assert.equal(phases.includes('ready'), false);
});

test('destroys a core that finishes construction after final teardown', async () => {
  let resolveCore: ((core: Live2DCore) => void) | undefined;
  let destroyCount = 0;
  const core: Live2DCore = {
    async load() {},
    resize() {},
    suspend() {},
    resume() {},
    destroy() {
      destroyCount += 1;
    },
    playMotion() {},
    setExpression() {},
    on() {
      return this;
    },
  };
  const renderer = new Live2DRenderer({
    canvas: new EventTarget() as HTMLCanvasElement,
    request,
    ownsInput: () => true,
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
  let createCount = 0;
  let destroyCount = 0;
  const loadedPaths: string[] = [];
  const createCore = async (): Promise<Live2DCore> => {
    createCount += 1;
    const restoredCore: Live2DCore = {
      async load({ path }) {
        loadedPaths.push(path);
      },
      resize() {},
      suspend() {},
      resume() {},
      destroy() {
        destroyCount += 1;
      },
      playMotion() {},
      setExpression() {},
      on() {
        return restoredCore;
      },
    };
    return restoredCore;
  };
  const renderer = new Live2DRenderer({ canvas, request, ownsInput: () => true, createCore });
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
