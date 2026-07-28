import assert from 'node:assert/strict';
import test from 'node:test';
import { getLive2DFocusNodes, isLive2DEscapeHandled, markLive2DEscapeHandled, registerLive2DFocusNode } from './focus-scope';

test('registers nodes idempotently and marks handled escape events', () => {
  const node = { isConnected: true } as HTMLElement;
  const unregister = registerLive2DFocusNode(node);
  assert.deepEqual(getLive2DFocusNodes(), [node]);
  unregister();
  assert.deepEqual(getLive2DFocusNodes(), []);

  const event = new Event('keydown') as KeyboardEvent;
  markLive2DEscapeHandled(event);
  assert.equal(isLive2DEscapeHandled(event), true);
});
