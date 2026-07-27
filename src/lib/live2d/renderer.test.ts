import assert from 'node:assert/strict';
import test from 'node:test';
import { type Live2DCore, Live2DRenderer } from './renderer';

class FakeCore implements Live2DCore {
  readonly loads: string[] = [];
  active = 0;
  maxActive = 0;
  destroyed = 0;
  ready = true;
  resolveCurrent: (() => void) | null = null;
  private readonly listeners = new Map<'tap' | 'loaded', Array<(value?: string) => void>>();

  async load({ path }: { path: string }): Promise<void> {
    this.loads.push(path);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      await new Promise<void>((resolve) => {
        this.resolveCurrent = resolve;
      });
      if (this.ready) this.emit('loaded');
    } finally {
      this.active -= 1;
    }
  }

  resize() {}
  destroy() {
    this.destroyed += 1;
  }
  getParams() {
    return this.ready ? [{}] : [];
  }
  playMotion() {}
  setExpression() {}
  on(event: 'tap' | 'loaded', listener: (value?: string) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  private emit(event: 'tap' | 'loaded', value?: string) {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}

const selection = (key: string) => ({
  key,
  entryPath: `/models/${key}/model.json`,
  scale: 1,
  position: [0, 0] as [number, number],
});
const canvas = () => new EventTarget() as HTMLCanvasElement;

test('serializes upstream mutations and skips superseded queued selections', async () => {
  const core = new FakeCore();
  const renderer = new Live2DRenderer({ canvas: canvas(), createCore: async () => core });
  const first = renderer.load(selection('first'));
  await new Promise((resolve) => setImmediate(resolve));
  const second = renderer.load(selection('second'));
  const third = renderer.load(selection('third'));
  core.resolveCurrent?.();
  await assert.rejects(first, { name: 'AbortError' });
  await assert.rejects(second, { name: 'AbortError' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(core.loads, ['/models/first/model.json', '/models/third/model.json']);
  core.resolveCurrent?.();
  await third;
  assert.equal(core.maxActive, 1);
  assert.equal(renderer.getPhase(), 'ready');
  renderer.destroy();
});

test('treats an upstream silent initialization failure as recoverable', async () => {
  const core = new FakeCore();
  core.ready = false;
  const renderer = new Live2DRenderer({ canvas: canvas(), createCore: async () => core });
  const loading = renderer.load(selection('broken'));
  await new Promise((resolve) => setImmediate(resolve));
  core.resolveCurrent?.();
  await assert.rejects(loading, /did not finish loading/);
  assert.equal(renderer.getPhase(), 'recoverable');
  renderer.destroy();
});

test('suspend releases the model and resume reloads the latest selection', async () => {
  const core = new FakeCore();
  const renderer = new Live2DRenderer({ canvas: canvas(), createCore: async () => core });
  const initial = renderer.load(selection('one'));
  await new Promise((resolve) => setImmediate(resolve));
  core.resolveCurrent?.();
  await initial;

  renderer.suspend();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renderer.getPhase(), 'dormant');
  assert.equal(core.destroyed, 1);
  renderer.resume();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(core.loads, ['/models/one/model.json', '/models/one/model.json']);
  core.resolveCurrent?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renderer.getPhase(), 'ready');
  renderer.destroy();
});
