import assert from 'node:assert/strict';
import test from 'node:test';
import { clampParameterOverrides, parseStudioPose } from './studio-state';

const parameters = [
  { id: 'EyeOpen', min: 0, max: 1, value: 0.7, default: 1 },
  { id: 'Angle', min: -30, max: 30, value: 0, default: 0 },
];
test('pose edits stay inside model bounds and reject non-finite or unknown parameters', () => {
  assert.deepEqual(clampParameterOverrides({ EyeOpen: 3, Angle: -90, Unknown: 10 }, parameters), { EyeOpen: 1, Angle: -30 });
  assert.deepEqual(clampParameterOverrides({ EyeOpen: NaN, Angle: '5' }, parameters), {});
});
test('pose import is bounded, model-specific and never interprets URLs or arbitrary object keys', () => {
  assert.deepEqual(
    parseStudioPose(
      JSON.stringify({ version: 1, model: 'anon/casual', parameters: { EyeOpen: 0.2 } }),
      'anon/casual',
      parameters,
    ),
    { EyeOpen: 0.2 },
  );
  assert.throws(() => parseStudioPose('{"version":1,"model":"other","parameters":{}}', 'anon/casual', parameters));
  assert.throws(() => parseStudioPose(' '.repeat(100001), 'anon/casual', parameters));
  assert.throws(() => parseStudioPose('{"version":1,"model":"anon/casual","parameters":[]}', 'anon/casual', parameters));
});
