import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResourceRequestHook } from 'l2d';
import { type Live2DCore, Live2DRenderer } from './renderer';

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
    canvas: {} as HTMLCanvasElement,
    request: (async () => new Response()) as ResourceRequestHook,
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
