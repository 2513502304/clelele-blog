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
  assert.equal(providerPrompt('Ann meets Annette. Ann smiles.', 'Ann', 'A'), 'A meets Annette. A smiles.');
  assert.throws(() => providerPrompt('Annette smiles.', 'Ann', 'A'));
});
it('requires provenance and ordered hashed outputs before publication', () => {
  assert.equal(generationManifestSchema.safeParse({ version: 1, id: 'test', outputs: [{ file: 'a.png' }] }).success, false);
});

it('retains raw request order and rejects incomplete provider provenance', () => {
  const request = {
    model: 'text-model',
    messages: [{ role: 'user', content: 'prompt', extra: 'preserved' }],
    temperature: 0.5,
  };
  const manifest = {
    version: 1,
    id: 'test',
    createdAt: '2026-09-26T00:00:00Z',
    source: { slug: 'source', promptId: 'a'.repeat(64), template: 'Template' },
    character: { name: 'Ann', tag: 'ann', traits: 'blue eyes' },
    rewrite: { provider: 'text', model: 'text-model', request, response: { text: 'Ann smiles' }, prompt: 'Ann smiles' },
    generation: {
      provider: 'pixai',
      model: 'model',
      prompt: 'ann smiles',
      parameters: {},
      request: { prompt: 'ann smiles' },
      response: { task: 'done' },
    },
    outputs: [{ file: 'image.png', sha256: 'b'.repeat(64), providerIndex: 0 }],
  };
  assert.equal(JSON.stringify(generationManifestSchema.parse(manifest).rewrite.request), JSON.stringify(request));
  for (const section of ['rewrite', 'generation'] as const) {
    for (const key of ['request', 'response']) {
      for (const value of [null, undefined, {}, []]) {
        assert.equal(
          generationManifestSchema.safeParse({ ...manifest, [section]: { ...manifest[section], [key]: value } }).success,
          false,
        );
      }
    }
  }
});
