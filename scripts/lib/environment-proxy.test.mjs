import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { supportsEnvironmentProxyStartup } from './environment-proxy.mjs';

describe('environment proxy runtime support', () => {
  it('accepts only Node release lines that implement the startup proxy switch', () => {
    assert.equal(supportsEnvironmentProxyStartup('22.9.0'), false);
    assert.equal(supportsEnvironmentProxyStartup('22.20.0'), false);
    assert.equal(supportsEnvironmentProxyStartup('22.21.0'), true);
    assert.equal(supportsEnvironmentProxyStartup('24.4.1'), false);
    assert.equal(supportsEnvironmentProxyStartup('24.5.0'), true);
    assert.equal(supportsEnvironmentProxyStartup('25.0.0'), true);
    assert.equal(supportsEnvironmentProxyStartup('invalid'), false);
  });
});
