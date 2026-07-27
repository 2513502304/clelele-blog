import assert from 'node:assert/strict';
import test from 'node:test';
import { Live2DInteractionGeneration, resolveLive2DInteraction } from './interactions';

const interactions = [
  { area: 'head', motionGroup: 'tap', lines: ['one', 'two'] },
  { area: 'body', lines: ['body'] },
];

test('resolves exact areas, deterministic lines, and unknown-area fallback', () => {
  assert.equal(resolveLive2DInteraction(interactions, ' BODY ', () => 0.5)?.line, 'body');
  assert.equal(resolveLive2DInteraction(interactions, 'missing', () => 0.99)?.line, 'two');
  assert.equal(resolveLive2DInteraction([], 'head'), null);
});

test('invalidating an interaction generation makes late work stale', () => {
  const generations = new Live2DInteractionGeneration();
  const first = generations.next();
  assert.equal(generations.isCurrent(first), true);
  generations.invalidate();
  assert.equal(generations.isCurrent(first), false);
});
