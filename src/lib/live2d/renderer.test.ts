import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResourceRequestHook } from 'l2d';
import { type Live2DCore, Live2DRenderer } from './renderer';

class FakeCore implements Live2DCore {
  readonly loads: Array<{ path: string; signal?: AbortSignal }> = [];
  active = 0;
  maxActive = 0;
  destroyed = 0;
  resolveCurrent: (() => void) | null = null;
  tap: ((area: string) => void) | null = null;

  async load(options: { path: string; signal?: AbortSignal }): Promise<void> {
    this.loads.push(options);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      await new Promise<void>((resolve, reject) => {
        this.resolveCurrent = resolve;
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
      });
    } finally {
      this.active -= 1;
    }
  }

  resize() {}
  suspend() {}
  resume() {}
  destroy() {
    this.destroyed += 1;
  }
  playMotion() {}
  setExpression() {}
  on(_event: 'tap', listener: (areaName: string) => void) {
    this.tap = listener;
    return this;
  }
}

const selection = (key: string) => ({
  key,
  entryPath: `/models/${key}/model.json`,
  scale: 1,
  position: [0, 0] as [number, number],
});
const request = (async () => new Response()) as ResourceRequestHook;
const canvas = () => new EventTarget() as HTMLCanvasElement;

test('serializes mutations and keeps only the latest queued selection', async () => {
  const core = new FakeCore();
  const renderer = new Live2DRenderer({
    canvas: canvas(),
    request,
    ownsInput: () => true,
    createCore: async () => core,
  });
  const first = renderer.load(selection('first'));
  await new Promise((resolve) => setImmediate(resolve));
  const second = renderer.load(selection('second'));
  const third = renderer.load(selection('third'));
  await assert.rejects(first, { name: 'AbortError' });
  await assert.rejects(second, { name: 'AbortError' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(core.loads.at(-1)?.path, '/models/third/model.json');
  core.resolveCurrent?.();
  await third;
  assert.equal(core.maxActive, 1);
  assert.equal(renderer.getPhase(), 'ready');
  renderer.destroy();
});

test('times out each attempt independently and permits a later retry', async () => {
  const core = new FakeCore();
  const renderer = new Live2DRenderer({
    canvas: canvas(),
    request,
    ownsInput: () => true,
    createCore: async () => core,
    timeoutMs: 10,
  });
  await assert.rejects(renderer.load(selection('slow')), { name: 'AbortError' });
  assert.equal(renderer.getPhase(), 'recoverable');
  const retry = renderer.load(selection('retry'));
  await new Promise((resolve) => setImmediate(resolve));
  core.resolveCurrent?.();
  await retry;
  assert.equal(renderer.getPhase(), 'ready');
  renderer.destroy();
});

test('prepares package bytes inside the same generation timeout before core loading', async () => {
  const core = new FakeCore();
  const order: string[] = [];
  const renderer = new Live2DRenderer({
    canvas: canvas(),
    request,
    ownsInput: () => true,
    prepare: async (signal) => {
      assert.equal(signal.aborted, false);
      order.push('prepare');
    },
    createCore: async () => {
      order.push('core');
      return core;
    },
  });
  const loading = renderer.load(selection('prepared'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['prepare', 'core']);
  core.resolveCurrent?.();
  await loading;
  renderer.destroy();
});
