import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { it } from 'node:test';

it('the container forwards only allowlisted purchase bindings and no unrelated session state', async () => {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const source =
        specifier === 'cloudflare:workers'
          ? 'export class WorkerEntrypoint {}'
          : specifier === '@cloudflare/containers'
            ? 'export class Container { constructor(ctx,env) { this.env=env; } } export function getContainer() {}'
            : null;
      return source
        ? { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
        : nextResolve(specifier, context);
    },
  });
  try {
    const { BlogContainer } = await import('../../../cloudflare/container-worker.mjs');
    // This module uses the hook's synthetic constructor, not a live Durable Object platform context.
    const container: object = Reflect.construct(BlogContainer, [
      undefined,
      {
        HPOI_PURCHASES_BUCKET: 'private-purchases-test',
        HPOI_PURCHASES_COOKIE: 'synthetic-test-session',
        UNRELATED_SESSION: 'must-not-forward',
      },
    ]);
    const vars: object = Reflect.get(container, 'envVars');
    assert.equal(Reflect.get(vars, 'HPOI_PURCHASES_BUCKET'), 'private-purchases-test');
    assert.equal(Reflect.get(vars, 'HPOI_PURCHASES_COOKIE'), 'synthetic-test-session');
    assert.equal(Reflect.get(vars, 'UNRELATED_SESSION'), undefined);
    const cachedOnly: object = Reflect.construct(BlogContainer, [
      undefined,
      { HPOI_PURCHASES_BUCKET: 'private-purchases-test' },
    ]);
    assert.equal(Reflect.get(Reflect.get(cachedOnly, 'envVars'), 'HPOI_PURCHASES_COOKIE'), undefined);
  } finally {
    hooks.deregister();
  }
});
