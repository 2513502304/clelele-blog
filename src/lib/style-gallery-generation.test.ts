import assert from 'node:assert/strict';
import { it } from 'node:test';
import { generationManifestSchema, providerPrompt } from './style-gallery-generation';

it('changes only provider character names and rejects unresolved placeholders', () => {
  assert.equal(
    providerPrompt('喜多郁代，玫红色长发。\n喜多郁代站在海边。', '喜多郁代', 'kita ikuyo'),
    'kita ikuyo，玫红色长发。\nkita ikuyo站在海边。',
  );
  assert.throws(() => providerPrompt('有人站在海边', '喜多郁代', 'kita ikuyo'));
  assert.throws(() => providerPrompt('喜多郁代 [在此处替换文字]', '喜多郁代', 'kita ikuyo'));
});
it('requires provenance and ordered hashed outputs before publication', () => {
  assert.equal(generationManifestSchema.safeParse({ version: 1, id: 'test', outputs: [{ file: 'a.png' }] }).success, false);
});
