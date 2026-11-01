import assert from 'node:assert/strict';
import test from 'node:test';
import { studioActionLabel, studioParameterLabel } from './studio-labels';

test('action translations preserve IDs, direction and numbered variants', () => {
  assert.equal(studioActionLabel('mtn_bye01_C', 'zh'), '挥手告别 · 1 · 正面 — mtn_bye01_C');
  assert.equal(studioActionLabel('heart01', 'en'), 'Smitten · 1 — heart01');
  assert.equal(studioActionLabel('unknown02_L', 'zh'), 'unknown02_L');
  assert.match(studioActionLabel('Idle', 'ja'), /待機.*Idle/);
});
test('parameter labels accept both Cubism generations without guessing unknown parameters', () => {
  assert.equal(studioParameterLabel('ParamAngleX', 'zh'), '头部左右 — ParamAngleX');
  assert.equal(studioParameterLabel('PARAM_ANGLE_X', 'en'), 'Head yaw — PARAM_ANGLE_X');
  assert.equal(studioParameterLabel('ParamCustom', 'zh'), 'ParamCustom');
});
